// レトロテニス - ゲームロジック

// Canvas要素とコンテキストを取得
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ゲーム状態
let gameState = 'waiting'; // 'waiting', 'serving', 'playing', 'paused', 'gameWon', 'matchWon'

// デモモード管理
let demoState = {
    isDemo: false,
    lastUserInput: Date.now(),
    demoStartTime: 0,
    demoActionTimer: 0,
    waitingTimer: 0,  // 各状態での待機タイマー
    lastState: ''      // 前回の状態を記録
};

// テニススコア
let tennisScore = {
    games: [0, 0], // セットは削除、ゲーム数のみ
    points: [0, 0],
    isDeuce: false,
    advantage: -1, // -1: なし, 0: プレイヤー1, 1: プレイヤー2
    currentServer: 0, // 0: プレイヤー1, 1: プレイヤー2
    isMatchWon: false,
    winner: -1
};

// パドル設定
const paddleWidth = 10;
const paddleHeight = 60;
const paddleSpeed = 5;

// プレイヤー1（左・人間）
let player1 = {
    x: 20,
    y: canvas.height / 2 - paddleHeight / 2,
    dy: 0,
    prevY: canvas.height / 2 - paddleHeight / 2,
    velocity: 0
};

// プレイヤー2（右・コンピューター）
let player2 = {
    x: canvas.width - 30,
    y: canvas.height / 2 - paddleHeight / 2,
    dy: 0,
    targetY: canvas.height / 2 - paddleHeight / 2,
    difficulty: 0.8, // 0.0-1.0, 高いほど強い
    prevY: canvas.height / 2 - paddleHeight / 2,
    velocity: 0,
    reactionDelay: 0, // 反応遅延フレーム数
    predictionError: 0 // 予測誤差
};

// ボール設定
let ball = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    dx: 3,
    dy: 2,
    size: 8,
    hitCount: 0, // ラリー回数をカウント
    scored: false // ポイント済みフラグ
};

// キー入力管理
const keys = {};

// サウンドシステム
let audioContext = null;
let isMuted = false;

function initAudio() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
}

function playSound(type) {
    if (isMuted || !audioContext) return;
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    const currentTime = audioContext.currentTime;
    
    switch(type) {
        case 'paddle':
            // パドルヒット音 - 高めのピッチ
            oscillator.type = 'square';
            oscillator.frequency.setValueAtTime(800, currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(400, currentTime + 0.1);
            gainNode.gain.setValueAtTime(0.3, currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, currentTime + 0.1);
            oscillator.start(currentTime);
            oscillator.stop(currentTime + 0.1);
            break;
            
        case 'wall':
            // 壁バウンド音 - 低めのピッチ
            oscillator.type = 'triangle';
            oscillator.frequency.setValueAtTime(300, currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(200, currentTime + 0.05);
            gainNode.gain.setValueAtTime(0.2, currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, currentTime + 0.05);
            oscillator.start(currentTime);
            oscillator.stop(currentTime + 0.05);
            break;
            
        case 'score':
            // 得点音 - 下降音
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(1000, currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(100, currentTime + 0.3);
            gainNode.gain.setValueAtTime(0.4, currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, currentTime + 0.3);
            oscillator.start(currentTime);
            oscillator.stop(currentTime + 0.3);
            break;
            
        case 'serve':
            // サーブ音 - 上昇音
            oscillator.type = 'sawtooth';
            oscillator.frequency.setValueAtTime(200, currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(600, currentTime + 0.15);
            gainNode.gain.setValueAtTime(0.25, currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, currentTime + 0.15);
            oscillator.start(currentTime);
            oscillator.stop(currentTime + 0.15);
            break;
    }
}

// キーイベント処理
document.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
    
    // 最初のキー入力でオーディオを初期化
    if (!audioContext) {
        initAudio();
    }
    
    // ユーザー入力があったらデモモードを停止
    if (demoState.isDemo && (e.key === ' ' || e.key.toLowerCase() === 'w' || e.key.toLowerCase() === 's')) {
        stopDemo();
    }
    
    demoState.lastUserInput = Date.now();
    
    if (e.key === ' ') {
        if (gameState === 'waiting') {
            startServing();
        } else if (gameState === 'serving') {
            serveGame();
        } else if (gameState === 'gameWon') {
            nextGame();
        } else if (gameState === 'matchWon') {
            resetMatch();
        }
    }
    
    // ミュート切り替え
    if (e.key.toLowerCase() === 'm') {
        isMuted = !isMuted;
        console.log(isMuted ? '音を無効にしました' : '音を有効にしました');
    }
});

document.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
    demoState.lastUserInput = Date.now();
});

// スコア関連関数
function getPointDisplay(points, isDeuce, advantage, playerIndex) {
    if (isDeuce) {
        if (advantage === -1) return "40";
        if (advantage === playerIndex) return "Ad";
        return "40";
    }
    
    // テニスポイント表示: 0, 15, 30, 40
    const pointNames = ["0", "15", "30", "40"];
    return pointNames[Math.min(points, 3)];
}

function updateScoreDisplay() {
    document.getElementById('games1').textContent = tennisScore.games[0];
    document.getElementById('games2').textContent = tennisScore.games[1];
    
    // ポイント表示の処理
    document.getElementById('points1').textContent = getPointDisplay(
        tennisScore.points[0], tennisScore.isDeuce, tennisScore.advantage, 0
    );
    document.getElementById('points2').textContent = getPointDisplay(
        tennisScore.points[1], tennisScore.isDeuce, tennisScore.advantage, 1
    );
    
    let status = "";
    
    // デュース・アドバンテージの状態表示
    if (tennisScore.isDeuce) {
        if (tennisScore.advantage === -1) {
            status = "デュース";
        } else if (tennisScore.advantage === 0) {
            status = "プレイヤー アドバンテージ";
        } else if (tennisScore.advantage === 1) {
            status = "コンピューター アドバンテージ";
        }
    }
    
    // ゲーム状態による上書き
    if (gameState === 'gameWon') {
        status = `${tennisScore.winner === 0 ? 'プレイヤー' : 'コンピューター'} ゲーム勝利! (SPACE で次のゲーム)`;
    } else if (gameState === 'matchWon') {
        status = `${tennisScore.winner === 0 ? 'プレイヤー' : 'コンピューター'} マッチ勝利! (SPACE でリスタート)`;
    } else if (gameState === 'serving') {
        if (tennisScore.currentServer === 0) {
            status = `プレイヤーのサーブ - W/Sで位置調整、SPACEでサーブ`;
        } else {
            status = `コンピューターのサーブ`;
        }
    } else if (gameState === 'playing') {
        // プレイ中はデュース状態を優先して表示
        if (!tennisScore.isDeuce) {
            status = `サーバー: ${tennisScore.currentServer === 0 ? 'プレイヤー' : 'コンピューター'}`;
        }
    }
    
    document.getElementById('status').textContent = status;
}

function addPoint(playerIndex) {
    if (tennisScore.isMatchWon) return;
    
    if (tennisScore.isDeuce) {
        if (tennisScore.advantage === -1) {
            // デュースからアドバンテージへ
            tennisScore.advantage = playerIndex;
        } else if (tennisScore.advantage === playerIndex) {
            // アドバンテージからゲーム勝利
            winGame(playerIndex);
            return;
        } else {
            // 相手のアドバンテージから再びデュースへ
            tennisScore.advantage = -1;
        }
    } else {
        // 通常のポイント進行 0 → 1 → 2 → 3 → ゲーム勝利
        tennisScore.points[playerIndex]++;
        
        // ゲーム勝利判定
        if (tennisScore.points[playerIndex] >= 4) {
            if (tennisScore.points[playerIndex] - tennisScore.points[1 - playerIndex] >= 2) {
                // 2ポイント差でゲーム勝利
                winGame(playerIndex);
                return;
            } else if (tennisScore.points[0] >= 3 && tennisScore.points[1] >= 3) {
                // 両方が3ポイント以上でデュース
                tennisScore.isDeuce = true;
            }
        }
    }
    
    updateScoreDisplay();
}

function winGame(playerIndex) {
    tennisScore.games[playerIndex]++;
    tennisScore.winner = playerIndex;
    
    // マッチ勝利判定 - 3ゲーム先取で勝利
    if (tennisScore.games[playerIndex] >= 3) {
        tennisScore.isMatchWon = true;
        gameState = 'matchWon';
    } else {
        gameState = 'gameWon';
    }
    
    updateScoreDisplay();
}

// ゲーム制御関数
function startServing() {
    gameState = 'serving';
    prepareServe();
    updateScoreDisplay();
}

function prepareServe() {
    // サーブ準備：ボールをサーバーの位置に配置
    if (tennisScore.currentServer === 0) {
        ball.x = player1.x + paddleWidth + 15;
        ball.y = player1.y + paddleHeight / 2;
    } else {
        ball.x = player2.x - 15;
        ball.y = player2.y + paddleHeight / 2;
        // コンピューターは自動でサーブ
        setTimeout(() => serveGame(), 1000);
    }
}

function serveGame() {
    gameState = 'playing';
    ball.hitCount = 0; // ラリーカウンターリセット
    ball.scored = false; // ポイント済みフラグリセット
    
    // サーブの方向と速度を設定
    if (tennisScore.currentServer === 0) {
        ball.dx = 4;
        ball.dy = (Math.random() - 0.5) * 3;
    } else {
        ball.dx = -4;
        ball.dy = (Math.random() - 0.5) * 3;
    }
    
    // サーブ音を再生
    playSound('serve');
    
    updateScoreDisplay();
}

function nextGame() {
    // サーバー交代
    tennisScore.currentServer = 1 - tennisScore.currentServer;
    
    // ポイントリセット
    tennisScore.points = [0, 0];
    tennisScore.isDeuce = false;
    tennisScore.advantage = -1;
    
    startServing();
}

function resetMatch() {
    tennisScore = {
        games: [0, 0],
        points: [0, 0],
        isDeuce: false,
        advantage: -1,
        currentServer: 0,
        isMatchWon: false,
        winner: -1
    };
    gameState = 'waiting';
    updateScoreDisplay();
}

function resetBall() {
    // 次のポイントのためのサーブ準備
    startServing();
}

// ゲーム更新ロジック
function updateGame() {
    // プレイヤー1（人間）の移動とスピード計算
    player1.prevY = player1.y;
    if (keys['w'] && player1.y > 0) {
        player1.y -= paddleSpeed;
    }
    if (keys['s'] && player1.y < canvas.height - paddleHeight) {
        player1.y += paddleSpeed;
    }
    player1.velocity = player1.y - player1.prevY;
    
    // サーブ準備中の処理
    if (gameState === 'serving') {
        if (tennisScore.currentServer === 0) {
            // プレイヤーのサーブ準備中：ボールも一緒に移動
            ball.y = player1.y + paddleHeight / 2;
        } else {
            // コンピューターのサーブ準備中
            updateComputerPlayer();
            ball.y = player2.y + paddleHeight / 2;
        }
        return;
    }
    
    if (gameState !== 'playing') return;
    
    // プレイヤー2（コンピューター）のAI
    updateComputerPlayer();
    
    // ボールの移動
    ball.x += ball.dx;
    ball.y += ball.dy;
    
    // 上下の壁との衝突
    if (ball.y <= ball.size || ball.y >= canvas.height - ball.size) {
        ball.dy = -ball.dy;
        playSound('wall'); // 壁バウンド音を再生
    }
    
    // パドルとの衝突判定
    // プレイヤー1のパドル
    if (ball.x - ball.size <= player1.x + paddleWidth &&
        ball.y >= player1.y &&
        ball.y <= player1.y + paddleHeight &&
        ball.dx < 0) {
        ball.dx = -ball.dx;
        ball.dx *= 1.02;
        // パドルの動きをボールに反映
        ball.dy += player1.velocity * 0.3;
        ball.hitCount++; // ラリー回数増加
        playSound('paddle'); // パドルヒット音を再生
    }
    
    // プレイヤー2のパドル
    if (ball.x + ball.size >= player2.x &&
        ball.y >= player2.y &&
        ball.y <= player2.y + paddleHeight &&
        ball.dx > 0) {
        ball.dx = -ball.dx;
        ball.dx *= 1.02;
        // コンピューターパドルの動きをボールに反映
        ball.dy += player2.velocity * 0.3;
        ball.hitCount++; // ラリー回数増加
        playSound('paddle'); // パドルヒット音を再生
    }
    
    // ポイント判定
    if (!ball.scored) { // まだポイントが付いていない場合のみ
        if (ball.x < 0) {
            ball.scored = true; // ポイント済みフラグを立てる
            playSound('score'); // 得点音を再生
            addPoint(1); // コンピューターのポイント
            ball.hitCount = 0; // ラリーカウンターリセット
            if (gameState === 'playing') {
                setTimeout(() => resetBall(), 1000);
            }
        } else if (ball.x > canvas.width) {
            ball.scored = true; // ポイント済みフラグを立てる
            playSound('score'); // 得点音を再生
            addPoint(0); // プレイヤーのポイント
            ball.hitCount = 0; // ラリーカウンターリセット
            if (gameState === 'playing') {
                setTimeout(() => resetBall(), 1000);
            }
        }
    }
}

// コンピューターAI
function updateComputerPlayer() {
    // 前回の位置を記録
    player2.prevY = player2.y;
    
    // 反応遅延を処理
    if (player2.reactionDelay > 0) {
        player2.reactionDelay--;
        return; // 遅延中は移動しない
    }
    
    // ラリー回数に基づく難易度低下の計算
    let rallyDifficulty = Math.max(0.3, player2.difficulty - (ball.hitCount * 0.08));
    let fatigueMultiplier = Math.max(0.4, 1 - (ball.hitCount * 0.06));
    
    // ボールがコンピューター側に向かっている場合
    if (ball.dx > 0) {
        // ラリーが続くと反応が遅くなる
        if (ball.hitCount > 3 && Math.random() < 0.15 + (ball.hitCount * 0.05)) {
            player2.reactionDelay = Math.floor(2 + ball.hitCount * 0.5);
            return;
        }
        
        // ボールの予測位置を計算
        let timeToReach = (player2.x - ball.x) / ball.dx;
        let predictedY = ball.y + (ball.dy * timeToReach);
        
        // 壁での跳ね返りを考慮
        let bounceCount = 0;
        while (predictedY < 0 || predictedY > canvas.height) {
            bounceCount++;
            if (predictedY < 0) {
                predictedY = -predictedY;
            }
            if (predictedY > canvas.height) {
                predictedY = 2 * canvas.height - predictedY;
            }
            
            // 複数回跳ね返りがあると予測精度が落ちる
            if (bounceCount > 1 && ball.hitCount > 2) {
                let bounceError = (Math.random() - 0.5) * 40 * bounceCount;
                predictedY += bounceError;
            }
        }
        
        player2.targetY = predictedY - paddleHeight / 2;
        
        // ラリーが続くと予測誤差が大きくなる
        if (ball.hitCount > 2) {
            let predictionErrorRange = 20 + (ball.hitCount * 8);
            player2.predictionError = (Math.random() - 0.5) * predictionErrorRange * (1 - rallyDifficulty);
            player2.targetY += player2.predictionError;
        }
    } else {
        // ボールが離れていく場合は中央に戻る（疲労で遅くなる）
        player2.targetY = canvas.height / 2 - paddleHeight / 2;
    }
    
    // 難易度とラリー疲労に基づいた移動速度
    let baseSpeed = paddleSpeed * rallyDifficulty * fatigueMultiplier;
    
    // ラリーが続くとさらに遅くなる
    if (ball.hitCount > 5) {
        baseSpeed *= Math.max(0.3, 1 - ((ball.hitCount - 5) * 0.1));
    }
    
    // 基本的なランダムエラー
    let basicError = (Math.random() - 0.5) * 25 * (1 - rallyDifficulty);
    let adjustedTargetY = player2.targetY + basicError;
    
    // 境界チェック
    adjustedTargetY = Math.max(0, Math.min(canvas.height - paddleHeight, adjustedTargetY));
    
    // スムーズな移動
    let diff = adjustedTargetY - player2.y;
    if (Math.abs(diff) > baseSpeed) {
        player2.y += diff > 0 ? baseSpeed : -baseSpeed;
    } else {
        player2.y = adjustedTargetY;
    }
    
    // 境界チェック
    player2.y = Math.max(0, Math.min(canvas.height - paddleHeight, player2.y));
    
    // 速度を計算
    player2.velocity = player2.y - player2.prevY;
}

// 描画関数
function drawGame() {
    // 画面クリア - グラデーション背景
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#0f3460');
    gradient.addColorStop(1, '#16537e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // エンドゾーン風のゴールエリア
    // プレイヤー側（左）のエンドゾーン - 赤系のグラデーション
    const leftZoneGradient = ctx.createLinearGradient(0, 0, 20, 0);
    leftZoneGradient.addColorStop(0, 'rgba(255, 67, 67, 0.4)');
    leftZoneGradient.addColorStop(0.7, 'rgba(255, 107, 107, 0.25)');
    leftZoneGradient.addColorStop(1, 'rgba(255, 107, 107, 0.1)');
    ctx.fillStyle = leftZoneGradient;
    ctx.fillRect(0, 0, 20, canvas.height);
    
    // 左側のエンドゾーン内に縦ストライプパターン
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    for (let i = 0; i < 20; i += 4) {
        ctx.fillRect(i, 0, 2, canvas.height);
    }
    
    // コンピューター側（右）のエンドゾーン - 緑系のグラデーション
    const rightZoneGradient = ctx.createLinearGradient(canvas.width - 20, 0, canvas.width, 0);
    rightZoneGradient.addColorStop(0, 'rgba(150, 206, 180, 0.1)');
    rightZoneGradient.addColorStop(0.3, 'rgba(150, 206, 180, 0.25)');
    rightZoneGradient.addColorStop(1, 'rgba(120, 200, 160, 0.4)');
    ctx.fillStyle = rightZoneGradient;
    ctx.fillRect(canvas.width - 20, 0, 20, canvas.height);
    
    // 右側のエンドゾーン内に縦ストライプパターン
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    for (let i = canvas.width - 20; i < canvas.width; i += 4) {
        ctx.fillRect(i, 0, 2, canvas.height);
    }
    
    // 中央線を描画 - 明るい青（点線）
    ctx.strokeStyle = '#4ecdc4';
    ctx.lineWidth = 2;
    ctx.setLineDash([15, 10]);
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // パドルを描画 - カラフル
    // プレイヤーパドル（左）- 赤系
    if (demoState.isDemo) {
        ctx.shadowColor = '#00ffff';
        ctx.shadowBlur = 15;
    }
    const playerGradient = ctx.createLinearGradient(player1.x, player1.y, player1.x + paddleWidth, player1.y + paddleHeight);
    if (demoState.isDemo) {
        playerGradient.addColorStop(0, '#00ffff');
        playerGradient.addColorStop(1, '#0099cc');
    } else {
        playerGradient.addColorStop(0, '#ff6b6b');
        playerGradient.addColorStop(1, '#ee5a52');
    }
    ctx.fillStyle = playerGradient;
    ctx.fillRect(player1.x, player1.y, paddleWidth, paddleHeight);
    if (demoState.isDemo) {
        ctx.shadowBlur = 0;
    }
    
    // コンピューターパドル（右）- 緑系
    const computerGradient = ctx.createLinearGradient(player2.x, player2.y, player2.x + paddleWidth, player2.y + paddleHeight);
    computerGradient.addColorStop(0, '#96ceb4');
    computerGradient.addColorStop(1, '#74b9a0');
    ctx.fillStyle = computerGradient;
    ctx.fillRect(player2.x, player2.y, paddleWidth, paddleHeight);
    
    // ボールを描画 - 明るい黄色で光る効果
    if (gameState === 'playing' || gameState === 'serving') {
        // ボールの影効果
        ctx.beginPath();
        ctx.arc(ball.x + 2, ball.y + 2, ball.size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fill();
        
        // メインボール
        const ballGradient = ctx.createRadialGradient(ball.x - 2, ball.y - 2, 0, ball.x, ball.y, ball.size);
        ballGradient.addColorStop(0, '#ffeb3b');
        ballGradient.addColorStop(1, '#ffc107');
        ctx.fillStyle = ballGradient;
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.size, 0, Math.PI * 2);
        ctx.fill();
        
        // ボールのハイライト
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(ball.x - 3, ball.y - 3, 2, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // ゲーム開始前のメッセージ
    if (gameState === 'waiting') {
        ctx.font = '20px Courier New';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffeb3b';
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 2;
        ctx.strokeText('SPACE キーでゲーム開始', canvas.width / 2, canvas.height / 2 + 50);
        ctx.fillText('SPACE キーでゲーム開始', canvas.width / 2, canvas.height / 2 + 50);
    }
    
    // サーブ準備中のメッセージ
    if (gameState === 'serving' && tennisScore.currentServer === 0) {
        ctx.font = '16px Courier New';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#4ecdc4';
        ctx.strokeStyle = '#45b7d1';
        ctx.lineWidth = 1;
        ctx.strokeText('W/S で位置調整, SPACE でサーブ', canvas.width / 2, 30);
        ctx.fillText('W/S で位置調整, SPACE でサーブ', canvas.width / 2, 30);
    }
}

// デモモード関連関数
function checkDemoMode() {
    if (demoState.isDemo || gameState !== 'waiting') return;
    
    // 5秒間操作がなければデモモード開始
    if (Date.now() - demoState.lastUserInput > 5000) {
        startDemo();
    }
}

function startDemo() {
    demoState.isDemo = true;
    demoState.demoStartTime = Date.now();
    demoState.demoActionTimer = 0;
    
    // デモ表示を表示
    document.getElementById('demoText').style.display = 'block';
    
    // デモゲームを自動開始
    setTimeout(() => {
        if (demoState.isDemo) {
            startServing();
            setTimeout(() => {
                if (demoState.isDemo && gameState === 'serving') {
                    serveGame();
                }
            }, 1500);
        }
    }, 500);
}

function stopDemo() {
    demoState.isDemo = false;
    demoState.lastUserInput = Date.now();
    
    // デモ表示を非表示
    document.getElementById('demoText').style.display = 'none';
}

function updateDemoAI() {
    demoState.demoActionTimer++;
    
    // 状態が変わったらタイマーをリセット
    if (gameState !== demoState.lastState) {
        demoState.waitingTimer = 0;
        demoState.lastState = gameState;
    }
    demoState.waitingTimer++;
    
    if (gameState === 'playing') {
        // プレイヤー1（左パドル）のAI制御
        const ballCenterY = ball.y;
        const paddleCenterY = player1.y + paddleHeight / 2;
        const targetY = ballCenterY - paddleHeight / 2;
        
        // スムーズな移動
        const diff = targetY - player1.y;
        if (Math.abs(diff) > 2) {
            if (diff > 0) {
                keys['s'] = true;
                keys['w'] = false;
            } else {
                keys['w'] = true;
                keys['s'] = false;
            }
        } else {
            keys['w'] = false;
            keys['s'] = false;
        }
    } else if (gameState === 'serving' && tennisScore.currentServer === 0) {
        // デモモード中のプレイヤーサーブを自動化
        if (demoState.waitingTimer > 60) { // 約1秒後にサーブ
            serveGame();
            demoState.waitingTimer = 0;
        }
    } else if (gameState === 'waiting') {
        // デモモード中は自動でゲーム開始
        if (demoState.waitingTimer > 120) { // 約2秒後にゲーム開始
            startServing();
            demoState.waitingTimer = 0;
        }
    } else if (gameState === 'gameWon') {
        // ゲーム勝利後、次のゲームに進むか、マッチ終了なら待機画面へ
        if (demoState.waitingTimer > 180) { // 約3秒後
            // 3ゲーム先取でマッチ終了の可能性をチェック
            if (tennisScore.games[0] >= 3 || tennisScore.games[1] >= 3) {
                // マッチ終了なので、デモを終了して待機画面へ
                stopDemo();
                resetMatch();
                demoState.lastUserInput = Date.now();
            } else {
                // まだマッチが続くので次のゲームへ
                nextGame();
            }
            demoState.waitingTimer = 0;
        }
    } else if (gameState === 'matchWon') {
        // マッチ勝利後、3秒待って待機画面へ戻す
        if (demoState.waitingTimer > 180) { // 約3秒後
            // デモモードを終了して待機画面へ
            stopDemo();
            resetMatch();
            // 待機画面になったので、lastUserInputを更新して5秒後にまたデモが始まるようにする
            demoState.lastUserInput = Date.now();
            demoState.waitingTimer = 0;
        }
    } else {
        keys['w'] = false;
        keys['s'] = false;
    }
}

// ゲームループ
function gameLoop() {
    // デモモードチェック
    if (!demoState.isDemo && gameState === 'waiting') {
        checkDemoMode();
    }
    
    // デモモード中のAI制御
    if (demoState.isDemo) {
        updateDemoAI();
    }
    
    updateGame();
    drawGame();
    requestAnimationFrame(gameLoop);
}

// ゲーム初期化と開始
updateScoreDisplay();
gameLoop();