import React, { useState, useEffect, useRef } from 'react';
import Peer from 'peerjs';

// --- Helpers & Constants ---
const generateShortId = () => Math.random().toString(36).substring(2, 8).toUpperCase();
const COLORS = ['#000000', '#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#FFFFFF'];
const FACES = ['😀', '😎', '🤪', '🥸', '🤖', '👽', '👻', '🤡'];
const RANDOM_NAMES = ["Bus Driver", "Pet Food", "Soggy Noodle", "Space Cowboy", "Night Owl"];
const SESSION_KEY = 'skribbl_p2p_session_v7';

// --- Emergency Fallback List ---
const FALLBACK_WORDS = ["apple", "elephant", "guitar", "sunflower", "mountain", "ocean", "bicycle", "pizza", "computer", "dragon", "castle", "wizard"];

export default function App() {
  // --- LocalStorage Initialization ---
  const loadSession = () => {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch(e) { return null; }
  };
  const initSession = loadSession() || {};

  // --- Network State ---
  const [peer, setPeer] = useState(null);
  const [myPeerId, setMyPeerId] = useState(initSession.myPeerId || '');
  const [joinId, setJoinId] = useState(initSession.joinId || '');
  const [roomHostId, setRoomHostId] = useState(initSession.roomHostId || ''); 
  const [connections, setConnections] = useState([]);
  const [activeConnection, setActiveConnection] = useState(null);
  const [isHost, setIsHost] = useState(initSession.isHost || false);
  const [networkStatus, setNetworkStatus] = useState('Disconnected');

  // --- Player State ---
  const [myPlayerId] = useState(() => initSession.myPlayerId || Math.random().toString(36).substr(2, 9));
  const [me, setMe] = useState(initSession.me || { name: '', color: COLORS[1], face: FACES[0] });
  const [players, setPlayers] = useState(initSession.players || []);

  // --- Game Settings (Host Only) ---
  const [settings, setSettings] = useState(initSession.settings || { rounds: 3, drawTime: 60, customWords: '', useOnlyCustom: false });

  // --- Game Loop State ---
  const [gameState, setGameState] = useState(initSession.gameState || 'menu'); 
  const [currentRound, setCurrentRound] = useState(initSession.currentRound || 1);
  const [drawerId, setDrawerId] = useState(initSession.drawerId || null);
  const [wordOptions, setWordOptions] = useState([]);
  const [currentWord, setCurrentWord] = useState(initSession.currentWord || '');
  const [timeLeft, setTimeLeft] = useState(initSession.timeLeft || 0);

  // --- UI & Canvas State ---
  const [chat, setChat] = useState(initSession.chat || []);
  const [guessInput, setGuessInput] = useState('');
  const [savedCanvas, setSavedCanvas] = useState(initSession.savedCanvas || null);
  const [copiedType, setCopiedType] = useState(null); 
  
  const canvasRef = useRef(null);
  const contextRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushColor, setBrushColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(5);

  // ==========================================
  // STALE CLOSURE & PERSISTENCE
  // ==========================================
  const stateRef = useRef({ gameState, players, currentRound, drawerId, currentWord, timeLeft, settings, savedCanvas, chat, roomHostId, isHost });
  const connsRef = useRef(connections);
  const peerRef = useRef(peer);

  useEffect(() => {
    stateRef.current = { gameState, players, currentRound, drawerId, currentWord, timeLeft, settings, savedCanvas, chat, roomHostId, isHost };
  }, [gameState, players, currentRound, drawerId, currentWord, timeLeft, settings, savedCanvas, chat, roomHostId, isHost]);

  useEffect(() => { connsRef.current = connections; }, [connections]);
  useEffect(() => { peerRef.current = peer; }, [peer]);

  useEffect(() => {
    const sessionToSave = {
      myPlayerId, me, myPeerId, joinId, isHost, players, settings, roomHostId,
      gameState, currentRound, drawerId, currentWord, timeLeft, chat, savedCanvas
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionToSave));
  }, [myPlayerId, me, myPeerId, joinId, isHost, players, settings, roomHostId, gameState, currentRound, drawerId, currentWord, timeLeft, chat, savedCanvas]);

  const handleLeaveRoom = () => {
    localStorage.removeItem(SESSION_KEY);
    window.location.href = window.location.pathname; 
  };

  const copyToClipboard = (type) => {
    const targetId = isHost ? myPeerId : joinId;
    if (type === 'code') navigator.clipboard.writeText(targetId);
    else if (type === 'link') navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?room=${targetId}`);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
  };

  // ==========================================
  // OFFICIAL SKRIBBL.IO WORD MANAGER
  // ==========================================
  const wordCache = useRef(new Map());

  const fetchSkribblWords = async () => {
    try {
      // Fetching the raw official Skribbl.io Word Bank from a public GitHub repository
      const response = await fetch('https://raw.githubusercontent.com/wlauyeung/Skribblio-Word-Bank/master/words_en_v1.0.0_raw.json');
      let words = await response.json();
      
      // Ensure it is a flat array
      if (!Array.isArray(words)) {
         words = Object.values(words).flat();
      }
      return words;
    } catch (err) { 
      console.warn("Failed to fetch official Skribbl words:", err); 
      return FALLBACK_WORDS;
    }
  };

  const getUnusedWords = async (count = 3) => {
    const state = stateRef.current;
    
    if (state.settings.useOnlyCustom) {
      let custom = state.settings.customWords.split(',').map(w => w.trim().toLowerCase()).filter(w => w);
      let unusedCustom = custom.filter(w => !wordCache.current.get(w));
      if (unusedCustom.length < count) {
        custom.forEach(w => wordCache.current.set(w, false)); 
        unusedCustom = custom;
      }
      return unusedCustom.sort(() => 0.5 - Math.random()).slice(0, count);
    }

    if (state.settings.customWords) {
      state.settings.customWords.split(',').forEach(w => {
        const clean = w.trim().toLowerCase();
        if (clean && !wordCache.current.has(clean)) wordCache.current.set(clean, false);
      });
    }

    let unused = Array.from(wordCache.current.entries()).filter(([_, used]) => !used).map(([w]) => w);
    
    if (unused.length < count) {
      const newWords = await fetchSkribblWords();
      newWords.forEach(w => {
        if (!wordCache.current.has(w.toLowerCase())) wordCache.current.set(w.toLowerCase(), false);
      });
      unused = Array.from(wordCache.current.entries()).filter(([_, used]) => !used).map(([w]) => w);
      
      if (unused.length < count) {
        FALLBACK_WORDS.forEach(w => wordCache.current.set(w.toLowerCase(), false));
        unused = Array.from(wordCache.current.keys());
      }
    }

    return unused.sort(() => 0.5 - Math.random()).slice(0, count);
  };

  // ==========================================
  // HOST MIGRATION LOGIC (CLIENT ONLY)
  // ==========================================
  const executeHostMigration = () => {
    const state = stateRef.current;
    const oldHostId = state.roomHostId;
    
    const updatedPlayers = state.players.map(p => p.id === oldHostId ? { ...p, connected: false } : p);
    const newHost = updatedPlayers.find(p => p.connected !== false);

    if (newHost) {
      setRoomHostId(newHost.id);
      setJoinId(newHost.peerId);
      window.history.replaceState({}, '', '?room=' + newHost.peerId); 

      if (newHost.id === myPlayerId) {
        setIsHost(true);
        setPlayers(updatedPlayers);
        setConnections([]); 
        const sysMsg = { sender: 'System', text: 'Host left. YOU are the new Host!', system: true, variant: 'warning' };
        setChat(prev => [...prev, sysMsg]);

        if (state.gameState === 'drawing' && state.drawerId === oldHostId) {
           setTimeout(() => endTurn(false, true), 500); 
        }
      } else {
        setPlayers(updatedPlayers);
        setChat(prev => [...prev, { sender: 'System', text: `Host migrated to ${newHost.name}. Reconnecting...`, system: true, variant: 'warning' }]);
        
        if (peerRef.current) {
          const newConn = peerRef.current.connect(newHost.peerId);
          newConn.on('open', () => {
            setActiveConnection(newConn);
            newConn.on('data', handleClientReceiveData);
            newConn.on('close', executeHostMigration); 
            newConn.send({ type: 'JOIN_LOBBY', payload: { id: myPlayerId, name: me.name, color: me.color, face: me.face } });
          });
        }
      }
    } else {
      handleLeaveRoom();
    }
  };

  // ==========================================
  // 1. PEER INITIALIZATION
  // ==========================================
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl && !initSession.joinId) setJoinId(roomFromUrl.toUpperCase());

    const customId = (initSession.isHost && initSession.myPeerId) ? initSession.myPeerId : generateShortId();
    const newPeer = new Peer(customId);
    
    newPeer.on('open', (id) => {
      setMyPeerId(id);
      setNetworkStatus('Ready');

      if (!initSession.isHost && initSession.joinId && initSession.gameState !== 'menu') {
        setNetworkStatus('Reconnecting...');
        const conn = newPeer.connect(initSession.joinId);
        conn.on('open', () => {
          setActiveConnection(conn);
          setNetworkStatus('Connected!');
          conn.on('data', handleClientReceiveData);
          conn.on('close', executeHostMigration); 
          conn.send({ type: 'JOIN_LOBBY', payload: { id: myPlayerId, name: initSession.me.name, color: initSession.me.color, face: initSession.me.face } });
        });
      }
    });

    newPeer.on('connection', (conn) => {
      conn.on('open', () => {
        setConnections(prev => {
          const exists = prev.find(c => c.peer === conn.peer);
          if (exists) return prev.map(c => c.peer === conn.peer ? conn : c);
          return [...prev, conn];
        });
        conn.on('data', (data) => handleHostReceiveData(data, conn));
      });
      
      conn.on('close', () => {
        setConnections(prev => prev.filter(c => c.peer !== conn.peer));
        const leavingPlayer = stateRef.current.players.find(p => p.peerId === conn.peer);
        
        if (leavingPlayer && stateRef.current.isHost) {
          setPlayers(prev => prev.map(p => p.id === leavingPlayer.id ? { ...p, connected: false } : p));
          const sysMsg = { sender: 'System', text: `${leavingPlayer.name} left the room.`, system: true, variant: 'error' };
          setChat(prev => [...prev, sysMsg]);
          broadcast({ type: 'CHAT', payload: sysMsg }, conn.peer);

          if (stateRef.current.gameState === 'drawing' && stateRef.current.drawerId === leavingPlayer.id) {
             endTurn(false, true); 
          }
        }
      });
    });

    setPeer(newPeer);
    return () => newPeer.destroy();
  }, []);

  useEffect(() => {
    if (isHost && gameState !== 'menu') {
      broadcast({
        type: 'SYNC_STATE',
        payload: { gameState, players, currentRound, drawerId, currentWord, timeLeft, settings, savedCanvas, roomHostId }
      });
    }
  }, [gameState, players, currentRound, drawerId, currentWord, timeLeft, isHost, roomHostId]);

  useEffect(() => {
    let timer;
    if (isHost && gameState === 'drawing' && timeLeft > 0) {
      timer = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
    } else if (isHost && gameState === 'drawing' && timeLeft === 0) {
      endTurn(false);
    }
    return () => clearInterval(timer);
  }, [isHost, gameState, timeLeft]);

  // ==========================================
  // 2. NETWORK ROUTING & EXPLICIT CLOSE
  // ==========================================
  const broadcast = (data, excludePeerId = null) => {
    connsRef.current.forEach(conn => {
      if (conn.open && conn.peer !== excludePeerId) conn.send(data);
    });
  };
  const sendToHost = (data) => activeConnection && activeConnection.open && activeConnection.send(data);

  const closeRoomEntirely = () => {
    broadcast({ type: 'ROOM_CLOSED' });
    setTimeout(() => { handleLeaveRoom(); }, 500);
  };

  const applyCanvasState = (base64String) => {
    if (base64String && canvasRef.current) {
      const img = new Image();
      img.src = base64String;
      img.onload = () => {
        canvasRef.current.getContext('2d').clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        canvasRef.current.getContext('2d').drawImage(img, 0, 0);
      };
      setSavedCanvas(base64String);
    }
  };

  const handleClientReceiveData = (data) => {
    switch (data.type) {
      case 'SYNC_STATE':
        setGameState(data.payload.gameState);
        setPlayers(data.payload.players);
        setCurrentRound(data.payload.currentRound);
        setDrawerId(data.payload.drawerId);
        setCurrentWord(data.payload.currentWord);
        setTimeLeft(data.payload.timeLeft);
        setSettings(data.payload.settings);
        setRoomHostId(data.payload.roomHostId);
        applyCanvasState(data.payload.savedCanvas);
        break;
      case 'WORD_OPTIONS': setWordOptions(data.payload); break;
      case 'CHAT': setChat(prev => [...prev, data.payload]); break;
      case 'DRAW': 
        executeDrawCommand(data.payload); 
        if (data.payload.isNewStroke && canvasRef.current) setSavedCanvas(canvasRef.current.toDataURL());
        break;
      case 'CLEAR_CANVAS': executeClear(); break;
      case 'ROOM_CLOSED': handleLeaveRoom(); break; 
      default: break;
    }
  };

  const handleHostReceiveData = (data, conn) => {
    switch (data.type) {
      case 'JOIN_LOBBY': {
        const exists = stateRef.current.players.find(p => p.id === data.payload.id);
        const msgText = exists ? `${data.payload.name} reconnected!` : `${data.payload.name} joined the room!`;
        const sysMsg = { sender: 'System', text: msgText, system: true, variant: exists ? 'success' : 'default' };
        
        const updatedChat = [...stateRef.current.chat, sysMsg];
        setChat(updatedChat);
        broadcast({ type: 'CHAT', payload: sysMsg }, conn.peer);

        setPlayers(prev => {
          if (exists) return prev.map(p => p.id === data.payload.id ? { ...p, peerId: conn.peer, connected: true } : p);
          return [...prev, { ...data.payload, peerId: conn.peer, score: 0, hasGuessed: false, connected: true }];
        });
        
        if (stateRef.current.gameState !== 'menu') {
          conn.send({ type: 'SYNC_STATE', payload: { ...stateRef.current, chat: updatedChat } });
        }
        break;
      }
      case 'CHAT_MESSAGE': handleChat(data.payload.text, data.payload.playerId); break;
      case 'WORD_CHOSEN': hostWordChosen(data.payload); break;
      case 'DRAW':
        executeDrawCommand(data.payload);
        if (data.payload.isNewStroke && canvasRef.current) setSavedCanvas(canvasRef.current.toDataURL());
        broadcast({ type: 'DRAW', payload: data.payload }, conn.peer); 
        break;
      case 'CLEAR_CANVAS':
        executeClear();
        broadcast({ type: 'CLEAR_CANVAS' }, conn.peer);
        break;
      default: break;
    }
  };

  // ==========================================
  // 3. LOBBY SETUP
  // ==========================================
  const randomizeAvatar = () => setMe({ ...me, color: COLORS[Math.floor(Math.random() * COLORS.length)], face: FACES[Math.floor(Math.random() * FACES.length)] });
  const getFinalName = () => me.name.trim() || RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];

  const hostGame = () => {
    setIsHost(true);
    setRoomHostId(myPlayerId);
    const finalName = getFinalName();
    setMe(prev => ({ ...prev, name: finalName }));
    setPlayers([{ id: myPlayerId, peerId: myPeerId, name: finalName, color: me.color, face: me.face, score: 0, hasGuessed: false, connected: true }]);
    setGameState('lobby');
    window.history.replaceState({}, document.title, '?room=' + myPeerId);
  };

  const joinGame = () => {
    if (!joinId) return;
    const finalName = getFinalName();
    setMe(prev => ({ ...prev, name: finalName }));
    const conn = peer.connect(joinId.toUpperCase());
    conn.on('open', () => {
      setActiveConnection(conn);
      setNetworkStatus('Connected!');
      conn.on('data', handleClientReceiveData);
      conn.on('close', executeHostMigration);
      conn.send({ type: 'JOIN_LOBBY', payload: { id: myPlayerId, name: finalName, color: me.color, face: me.face } });
    });
  };

  // ==========================================
  // 4. GAME LOOP LOGIC (HOST ONLY)
  // ==========================================
  const startGame = () => {
    const active = players.filter(p => p.connected !== false);
    if (active.length < 2) return; 
    setPlayers(prev => prev.map(p => ({ ...p, score: 0, hasGuessed: false })));
    setCurrentRound(1);
    wordCache.current.forEach((_, key) => wordCache.current.set(key, false));
    startTurn(active[0].id);
  };

  const startTurn = async (nextDrawerId) => {
    const active = stateRef.current.players.filter(p => p.connected !== false);
    if (active.length < 2) {
      setGameState('lobby');
      const sysMsg = { sender: 'System', text: 'Not enough players left. Returning to lobby.', system: true, variant: 'error' };
      setChat(prev => [...prev, sysMsg]);
      broadcast({ type: 'CHAT', payload: sysMsg });
      return;
    }

    setPlayers(prev => prev.map(p => ({ ...p, hasGuessed: false })));
    setDrawerId(nextDrawerId);
    setCurrentWord('');
    
    const options = await getUnusedWords(3);
    
    setGameState('word_select');
    setTimeLeft(15); 

    if (nextDrawerId === myPlayerId) {
      setWordOptions(options);
    } else {
      const drawerClient = connsRef.current.find(c => stateRef.current.players.find(p => p.id === nextDrawerId)?.peerId === c.peer);
      if (drawerClient && drawerClient.open) drawerClient.send({ type: 'WORD_OPTIONS', payload: options });
    }
  };

  const hostWordChosen = (word) => {
    const state = stateRef.current;
    wordCache.current.set(word.toLowerCase(), true);
    setCurrentWord(word);
    setGameState('drawing');
    setTimeLeft(state.settings.drawTime);
    executeClear();
    broadcast({ type: 'CLEAR_CANVAS' });
  };

  const handleChat = (text, playerId) => {
    const state = stateRef.current; 
    const player = state.players.find(p => p.id === playerId);
    if (!player) return;

    if (state.gameState === 'drawing' && playerId !== state.drawerId && !player.hasGuessed && text.trim().toLowerCase() === state.currentWord.toLowerCase()) {
      const points = Math.max(10, Math.floor((state.timeLeft / state.settings.drawTime) * 100));
      
      setPlayers(prev => {
        const updated = prev.map(p => {
          if (p.id === playerId) return { ...p, score: p.score + points, hasGuessed: true };
          if (p.id === state.drawerId) return { ...p, score: p.score + 15 }; 
          return p;
        });

        const activeNonDrawers = updated.filter(p => p.id !== state.drawerId && p.connected !== false);
        if (activeNonDrawers.length > 0 && activeNonDrawers.every(p => p.hasGuessed)) {
           setTimeout(() => endTurn(true), 100); 
        }
        return updated;
      });

      const sysMsg = { sender: 'System', text: `${player.name} guessed the word!`, system: true, variant: 'success' };
      setChat(prev => [...prev, sysMsg]);
      broadcast({ type: 'CHAT', payload: sysMsg });
      return;
    }

    const isHidden = (state.gameState === 'drawing' && player.hasGuessed);
    const msg = { sender: player.name, text, isHidden };
    setChat(prev => [...prev, msg]);
    broadcast({ type: 'CHAT', payload: msg });
  };

  const endTurn = (allGuessed, forcedSkip = false) => {
    const state = stateRef.current;
    setGameState('round_end');
    
    let endText = `The word was ${state.currentWord}!`;
    if (forcedSkip) endText = "Drawer disconnected. Turn skipped!";
    
    const sysMsg = { sender: 'System', text: endText, system: true, variant: forcedSkip ? 'error' : 'default' };
    setChat(prev => [...prev, sysMsg]);
    broadcast({ type: 'CHAT', payload: sysMsg });

    setTimeout(() => {
      const latestState = stateRef.current; 
      const activePlayers = latestState.players.filter(p => p.connected !== false);
      
      if (activePlayers.length < 2) {
        setGameState('lobby');
        return;
      }

      const currentIndex = latestState.players.findIndex(p => p.id === latestState.drawerId);
      let nextPlayer = null;
      
      for (let i = 1; i <= latestState.players.length; i++) {
         const idx = (currentIndex + i) % latestState.players.length;
         if (latestState.players[idx].connected !== false) {
             nextPlayer = latestState.players[idx];
             if (idx <= currentIndex) break;
             startTurn(nextPlayer.id);
             return;
         }
      }

      if (latestState.currentRound < latestState.settings.rounds) {
        setCurrentRound(prev => prev + 1);
        startTurn(activePlayers[0].id); 
      } else {
        setGameState('game_over');
      }
    }, 5000);
  };

  // ==========================================
  // 5. CANVAS LOGIC
  // ==========================================
  useEffect(() => {
    if (gameState === 'drawing' && canvasRef.current) {
      const canvas = canvasRef.current;
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      const context = canvas.getContext("2d");
      context.lineCap = "round";
      context.lineJoin = "round";
      contextRef.current = context;

      if (savedCanvas) {
        const img = new Image();
        img.src = savedCanvas;
        img.onload = () => context.drawImage(img, 0, 0);
      }
    }
  }, [gameState]);

  const startDrawing = (e) => {
    if (myPlayerId !== drawerId) return;
    const { offsetX, offsetY } = e.nativeEvent;
    contextRef.current.beginPath();
    contextRef.current.moveTo(offsetX, offsetY);
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing || myPlayerId !== drawerId) return;
    const { offsetX, offsetY } = e.nativeEvent;
    executeDrawCommand({ x: offsetX, y: offsetY, color: brushColor, size: brushSize, isNewStroke: false });
    const payload = { x: offsetX, y: offsetY, color: brushColor, size: brushSize, isNewStroke: false };
    if (isHost) broadcast({ type: 'DRAW', payload });
    else sendToHost({ type: 'DRAW', payload });
  };

  const stopDrawing = () => {
    if (myPlayerId !== drawerId) return;
    contextRef.current.closePath();
    setIsDrawing(false);
    
    if (canvasRef.current) setSavedCanvas(canvasRef.current.toDataURL());

    const payload = { isNewStroke: true };
    if (isHost) broadcast({ type: 'DRAW', payload });
    else sendToHost({ type: 'DRAW', payload });
  };

  const executeDrawCommand = ({ x, y, color, size, isNewStroke }) => {
    if (!contextRef.current) return;
    if (isNewStroke) {
      contextRef.current.closePath();
      contextRef.current.beginPath();
      return;
    }
    contextRef.current.strokeStyle = color;
    contextRef.current.lineWidth = size;
    contextRef.current.lineTo(x, y);
    contextRef.current.stroke();
  };

  const reqClearCanvas = () => {
    if (myPlayerId !== drawerId) return;
    executeClear();
    if (isHost) broadcast({ type: 'CLEAR_CANVAS' });
    else sendToHost({ type: 'CLEAR_CANVAS' });
  };

  const executeClear = () => {
    if (!canvasRef.current || !contextRef.current) return;
    contextRef.current.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setSavedCanvas(null);
  };

  // ==========================================
  // UI HELPERS & RENDERING
  // ==========================================
  const renderHint = () => {
    if (!currentWord) return "";
    if (myPlayerId === drawerId || gameState === 'round_end' || gameState === 'game_over') return currentWord;
    
    const revealCount = Math.floor((1 - (timeLeft / settings.drawTime)) * (currentWord.length / 2));
    return currentWord.split('').map((char, index) => 
      (char === ' ' ? '  ' : (index < revealCount ? char : '_'))
    ).join(' ');
  };

  const renderPodium = () => {
    const sortedPlayers = [...players].sort((a,b) => b.score - a.score);
    const top3 = sortedPlayers.slice(0, 3);
    const others = sortedPlayers.slice(3);

    const podiumBlocks = [];
    if (top3[1]) podiumBlocks.push({ ...top3[1], rank: 2, height: 'h-24 md:h-32', color: 'bg-slate-300' });
    if (top3[0]) podiumBlocks.push({ ...top3[0], rank: 1, height: 'h-32 md:h-48', color: 'bg-yellow-400' });
    if (top3[2]) podiumBlocks.push({ ...top3[2], rank: 3, height: 'h-16 md:h-24', color: 'bg-orange-400' });

    return (
      <div className="flex flex-col items-center w-full max-w-2xl px-4">
        <div className="flex items-end justify-center gap-2 md:gap-4 mt-8 w-full">
          {podiumBlocks.map(p => (
            <div key={p.id} className="flex flex-col items-center">
              <div className={`w-12 h-12 md:w-16 md:h-16 rounded-full flex items-center justify-center text-2xl md:text-4xl mb-2 z-10 relative shadow-lg ${p.connected === false ? 'grayscale opacity-50' : ''}`} style={{ backgroundColor: p.color }}>{p.face}</div>
              <div className="font-bold text-white text-sm md:text-base truncate w-20 md:w-28 text-center">{p.name}</div>
              <div className="text-emerald-400 font-black text-lg md:text-xl mb-1">{p.score}</div>
              <div className={`w-20 md:w-28 ${p.height} ${p.color} rounded-t-lg flex justify-center pt-2 md:pt-4 text-3xl md:text-5xl font-black text-black/20 shadow-inner`}>{p.rank}</div>
            </div>
          ))}
        </div>
        {others.length > 0 && (
          <div className="mt-8 flex flex-col gap-2 w-full max-w-md">
            {others.map((p, i) => (
              <div key={p.id} className={`flex items-center gap-4 bg-white/10 px-6 py-3 rounded-xl w-full text-white ${p.connected === false ? 'opacity-50' : ''}`}>
                <div className="text-xl font-black w-8 text-slate-400">#{i + 4}</div>
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0 grayscale-0" style={{ backgroundColor: p.color }}>{p.face}</div>
                <div className="text-lg font-bold flex-grow truncate">{p.name}</div>
                <div className="text-xl font-black text-emerald-400">{p.score}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const iAmDrawer = myPlayerId === drawerId;
  const myPlayerData = players.find(p => p.id === myPlayerId) || { hasGuessed: false };

  // ==========================================
  // RENDER VIEWS
  // ==========================================
  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans text-slate-800">
      
      {/* HEADER */}
      <header className="bg-white p-3 shadow-sm border-b border-slate-200 flex flex-wrap justify-between items-center z-10 gap-2">
        <h1 className="text-2xl font-black tracking-tight text-indigo-600">Skribbl<span className="text-slate-800">.clone</span></h1>
        
        {gameState !== 'menu' && (
          <div className="flex flex-wrap items-center gap-4 text-sm font-bold">
            <div className="hidden md:flex items-center gap-2 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100">
              <span className="text-indigo-800">Room Code: <span className="font-mono">{roomHostId === myPlayerId ? myPeerId : joinId}</span></span>
              <button onClick={() => copyToClipboard('code')} className="text-xs bg-white border border-indigo-200 hover:bg-indigo-100 text-indigo-600 px-2 py-1 rounded transition-colors cursor-pointer">
                {copiedType === 'code' ? 'Copied!' : 'Copy'}
              </button>
              <button onClick={() => copyToClipboard('link')} className="text-xs bg-indigo-500 hover:bg-indigo-600 text-white px-2 py-1 rounded transition-colors cursor-pointer">
                {copiedType === 'link' ? 'Copied Link!' : 'Invite Link'}
              </button>
            </div>
            
            <div className="text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg">Round {currentRound} / {settings.rounds}</div>
            
            <div className={`text-lg bg-slate-100 px-3 py-1 rounded-lg ${timeLeft <= 10 ? 'text-red-500 animate-pulse bg-red-50' : 'text-slate-800'}`}>
              ⏱ {timeLeft}s
            </div>

            {isHost ? (
               <div className="flex gap-2">
                 <button onClick={handleLeaveRoom} className="bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer">
                   Leave
                 </button>
                 <button onClick={closeRoomEntirely} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer shadow-sm">
                   Close Room
                 </button>
               </div>
            ) : (
              <button onClick={handleLeaveRoom} className="bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer">
                Leave
              </button>
            )}
          </div>
        )}
      </header>

      {gameState === 'menu' && (
        <div className="flex-grow flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-sm border border-slate-200 text-center">
            <div className="mb-6 relative w-32 h-32 mx-auto rounded-full border-4 shadow-inner flex items-center justify-center text-6xl" style={{ backgroundColor: me.color, borderColor: 'rgba(0,0,0,0.1)' }}>
              {me.face}
              <button onClick={randomizeAvatar} className="absolute -bottom-2 -right-2 bg-indigo-500 text-white text-sm p-2 rounded-full shadow hover:bg-indigo-600 cursor-pointer">🎲</button>
            </div>
            <input type="text" placeholder="Enter your name" className="w-full p-3 border-2 border-slate-200 rounded-xl mb-6 focus:border-indigo-500 outline-none text-center font-bold text-lg" value={me.name} onChange={(e) => setMe({ ...me, name: e.target.value })} />
            <div className="space-y-3">
              <button onClick={hostGame} disabled={!myPeerId} className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-black py-4 rounded-xl shadow-[0_4px_0_rgb(5,150,105)] active:shadow-none active:translate-y-1 transition-all text-lg cursor-pointer">
                Create Private Room
              </button>
              <div className="flex gap-2">
                <input type="text" placeholder="Paste Code" className="flex-grow p-3 border-2 border-slate-200 rounded-xl focus:border-indigo-500 outline-none text-center font-mono uppercase" value={joinId} onChange={(e) => setJoinId(e.target.value.toUpperCase())} />
                <button onClick={joinGame} disabled={!joinId || !myPeerId} className="bg-blue-500 hover:bg-blue-600 text-white font-bold px-6 rounded-xl shadow-[0_4px_0_rgb(37,99,235)] active:shadow-none active:translate-y-1 transition-all cursor-pointer">
                  Join
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {gameState === 'lobby' && (
        <div className="flex-grow flex flex-col items-center justify-center p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-4xl border border-slate-200 flex flex-col md:flex-row gap-8">
            <div className="flex-grow">
              <h2 className="text-2xl font-black mb-4 flex justify-between items-center">
                Lobby <span className="text-sm font-normal bg-slate-100 px-3 py-1 rounded-full text-slate-500">{players.filter(p=>p.connected!==false).length} Players</span>
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {players.map(p => (
                  <div key={p.id} className={`flex flex-col items-center p-3 rounded-xl border ${p.connected === false ? 'bg-slate-100 border-slate-200 opacity-50 grayscale' : 'bg-slate-50 border-slate-100'}`}>
                    <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl shadow-sm mb-2" style={{ backgroundColor: p.color }}>{p.face}</div>
                    <span className="font-bold text-sm w-full text-center truncate">
                      {p.name} {p.id === myPlayerId ? '(You)' : ''}
                    </span>
                    {p.connected === false && <span className="text-xs font-bold text-red-500 mt-1">Disconnected</span>}
                  </div>
                ))}
              </div>
            </div>

            {isHost ? (
              <div className="w-full md:w-80 bg-slate-50 p-6 rounded-xl border border-slate-200">
                <h3 className="font-bold mb-4 text-slate-700 uppercase tracking-wide text-sm">Room Settings</h3>
                <label className="block text-sm font-bold text-slate-600 mb-1">Rounds: {settings.rounds}</label>
                <input type="range" min="1" max="10" value={settings.rounds} onChange={e => setSettings({...settings, rounds: Number(e.target.value)})} className="w-full mb-4 accent-indigo-500 cursor-pointer" />
                <label className="block text-sm font-bold text-slate-600 mb-1">Draw Time: {settings.drawTime}s</label>
                <input type="range" min="30" max="180" step="10" value={settings.drawTime} onChange={e => setSettings({...settings, drawTime: Number(e.target.value)})} className="w-full mb-4 accent-indigo-500 cursor-pointer" />
                <label className="block text-sm font-bold text-slate-600 mb-1">Custom Words</label>
                <textarea rows="3" className="w-full p-2 border rounded-lg mb-2 text-sm outline-none focus:border-indigo-500" value={settings.customWords} onChange={e => setSettings({...settings, customWords: e.target.value})} placeholder="dog, cat, laser..." />
                <label className="flex items-center gap-2 text-sm font-bold text-slate-600 mb-6 cursor-pointer">
                  <input type="checkbox" checked={settings.useOnlyCustom} onChange={e => setSettings({...settings, useOnlyCustom: e.target.checked})} className="w-4 h-4 accent-indigo-500" /> Use custom words exclusively
                </label>
                
                <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-lg mb-4 text-center">
                  <span className="text-xs text-indigo-800 block mb-1 font-bold">INVITE CODE</span>
                  <strong className="text-3xl tracking-widest font-mono text-indigo-600 block mb-3">{myPeerId}</strong>
                  <div className="flex gap-2 justify-center">
                    <button onClick={() => copyToClipboard('code')} className="flex-1 bg-white border border-indigo-200 hover:bg-indigo-100 text-indigo-700 font-bold py-2 rounded text-sm transition-colors cursor-pointer">
                      {copiedType === 'code' ? 'Copied!' : 'Copy Code'}
                    </button>
                    <button onClick={() => copyToClipboard('link')} className="flex-1 bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-2 rounded text-sm transition-colors cursor-pointer">
                      {copiedType === 'link' ? 'Copied Link!' : 'Copy Link'}
                    </button>
                  </div>
                </div>

                <div className="flex gap-2 mb-4">
                  <button onClick={handleLeaveRoom} className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-2 rounded-xl transition-colors cursor-pointer">Leave</button>
                  <button onClick={closeRoomEntirely} className="flex-1 bg-red-100 hover:bg-red-200 text-red-700 font-bold py-2 rounded-xl transition-colors cursor-pointer">Close Room</button>
                </div>

                <button 
                  onClick={startGame} 
                  disabled={players.filter(p=>p.connected!==false).length < 2}
                  className={`w-full font-black py-3 rounded-xl transition-all ${players.filter(p=>p.connected!==false).length < 2 ? 'bg-slate-300 text-slate-500 cursor-not-allowed' : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-[0_4px_0_rgb(5,150,105)] active:translate-y-1 cursor-pointer'}`}
                >
                  {players.filter(p=>p.connected!==false).length < 2 ? 'Need 2+ Online' : 'Start Game'}
                </button>
              </div>
            ) : (
              <div className="w-full md:w-80 flex flex-col items-center justify-center text-slate-500 p-8 text-center bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-4xl mb-4 animate-spin">⏳</div>
                <p className="font-bold text-lg">Waiting for Host...</p>
                <p className="text-sm mb-4">Status: {networkStatus}</p>
                <button onClick={handleLeaveRoom} className="bg-red-100 text-red-600 px-4 py-2 rounded font-bold hover:bg-red-200 transition-colors cursor-pointer">Leave Lobby</button>
              </div>
            )}
          </div>
        </div>
      )}

      {(gameState === 'word_select' || gameState === 'drawing' || gameState === 'round_end' || gameState === 'game_over') && (
        <div className="flex-grow flex flex-col lg:flex-row max-w-[1400px] mx-auto w-full p-4 gap-4">
          <div className="w-full lg:w-48 flex flex-row lg:flex-col gap-2 overflow-x-auto lg:overflow-y-auto order-2 lg:order-1 shrink-0">
            {players.sort((a,b) => b.score - a.score).map((p, idx) => (
              <div key={p.id} className={`flex items-center gap-3 p-2 rounded-lg border-2 min-w-[160px] ${p.connected === false ? 'opacity-50 grayscale bg-slate-100 border-slate-200' : p.id === drawerId ? 'bg-indigo-50 border-indigo-200' : p.hasGuessed ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
                <div className="font-black text-slate-400 w-4 text-center">#{idx + 1}</div>
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0" style={{ backgroundColor: p.color }}>{p.face}</div>
                <div className="flex flex-col overflow-hidden">
                  <span className={`font-bold text-sm truncate ${p.connected === false ? 'line-through text-red-500' : ''}`}>{p.name}</span>
                  <span className="text-xs text-slate-500">{p.score} pts</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex-grow flex flex-col min-w-0 bg-white rounded-xl shadow-sm border border-slate-200 order-1 lg:order-2 overflow-hidden relative">
            <div className="bg-slate-50 border-b border-slate-200 p-3 text-center">
              <div className={`font-mono font-bold tracking-[0.5em] text-2xl uppercase ${gameState === 'round_end' ? 'text-emerald-600' : 'text-slate-700'}`}>{renderHint()}</div>
            </div>

            <div className="flex-grow relative bg-white cursor-crosshair h-[400px] lg:h-auto">
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full touch-none" onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing} />

              {gameState === 'word_select' && (
                <div className="absolute inset-0 bg-white/90 backdrop-blur-sm flex items-center justify-center z-20">
                  {iAmDrawer ? (
                    <div className="text-center">
                      <h2 className="text-3xl font-black mb-6 text-slate-800">Choose a word</h2>
                      <div className="flex gap-4 justify-center">
                        {wordOptions.map(w => (
                          <button key={w} onClick={() => { if(isHost) hostWordChosen(w); else sendToHost({ type: 'WORD_CHOSEN', payload: w }); }} className="bg-indigo-500 hover:bg-indigo-600 text-white font-bold text-xl py-4 px-8 rounded-xl shadow-[0_4px_0_rgb(67,56,202)] active:translate-y-1 transition-all uppercase cursor-pointer">{w}</button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center text-slate-500"><div className="text-5xl mb-4 animate-bounce">🤔</div><h2 className="text-2xl font-bold">The Drawer is choosing a word...</h2></div>
                  )}
                </div>
              )}

              {gameState === 'round_end' && (
                <div className="absolute inset-0 bg-white/90 backdrop-blur-sm flex flex-col items-center justify-center z-20 text-center">
                  <h2 className="text-4xl font-black mb-2 text-slate-800">Round Over!</h2>
                  <p className="text-2xl text-slate-600 mb-4">{chat[chat.length-1]?.text || 'Loading next round...'}</p>
                </div>
              )}

              {gameState === 'game_over' && (
                <div className="absolute inset-0 bg-slate-900/95 backdrop-blur-md flex flex-col items-center justify-center z-30 overflow-y-auto py-8">
                  <h1 className="text-5xl md:text-6xl font-black mb-2 text-white drop-shadow-lg">Game Over!</h1>
                  <p className="text-slate-300 font-medium mb-4">Final Standings</p>
                  
                  {renderPodium()}

                  <div className="mt-12 flex gap-4">
                    {isHost ? (
                      <>
                        <button onClick={handleLeaveRoom} className="bg-slate-700 hover:bg-slate-600 px-8 py-4 rounded-xl font-bold text-white shadow-lg active:scale-95 transition-all cursor-pointer">Leave</button>
                        <button onClick={closeRoomEntirely} className="bg-red-600 hover:bg-red-700 px-8 py-4 rounded-xl font-bold text-white shadow-lg active:scale-95 transition-all cursor-pointer">Close Room</button>
                      </>
                    ) : (
                      <button onClick={handleLeaveRoom} className="bg-slate-700 hover:bg-slate-600 px-8 py-4 rounded-xl font-bold text-white shadow-lg active:scale-95 transition-all cursor-pointer">Leave Room</button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {iAmDrawer && gameState === 'drawing' && (
              <div className="bg-slate-50 border-t border-slate-200 p-2 flex gap-4 justify-center items-center">
                <div className="flex flex-wrap gap-2 justify-center max-w-[200px] md:max-w-none">
                  {COLORS.map(c => <button key={c} onClick={() => setBrushColor(c)} className={`w-8 h-8 rounded-full border-2 shadow-sm cursor-pointer ${brushColor === c ? 'border-slate-800 scale-110' : 'border-slate-300'}`} style={{ backgroundColor: c }} />)}
                </div>
                <div className="w-px h-8 bg-slate-300"></div>
                <input type="range" min="2" max="40" value={brushSize} onChange={e => setBrushSize(e.target.value)} className="w-24 accent-indigo-500 cursor-pointer" />
                <div className="w-px h-8 bg-slate-300"></div>
                <button onClick={reqClearCanvas} className="bg-red-100 hover:bg-red-200 text-red-700 font-bold p-2 rounded-lg cursor-pointer" title="Trash / Clear">🗑️</button>
              </div>
            )}
          </div>

          <div className="w-full lg:w-72 flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 h-64 lg:h-auto order-3 shrink-0 overflow-hidden">
            <div className="bg-slate-50 p-3 border-b border-slate-200 font-bold text-slate-700">Chat & Guesses</div>
            <div className="flex-grow overflow-y-auto p-3 flex flex-col gap-1.5 text-sm">
              {chat.map((msg, i) => {
                if (msg.system) {
                  let bgColor = 'bg-slate-100';
                  let textColor = 'text-slate-600';
                  if (msg.variant === 'success') { bgColor = 'bg-emerald-50'; textColor = 'text-emerald-600'; }
                  if (msg.variant === 'error') { bgColor = 'bg-red-50'; textColor = 'text-red-600'; }
                  if (msg.variant === 'warning') { bgColor = 'bg-amber-50'; textColor = 'text-amber-600'; }
                  return <div key={i} className={`${textColor} font-bold text-center ${bgColor} py-1.5 rounded my-1 shadow-sm`}>{msg.text}</div>;
                }
                
                if (msg.isHidden && !myPlayerData.hasGuessed && !iAmDrawer) return <div key={i} className="text-slate-400 italic">🔒 <span className="font-bold">{msg.sender}</span> is chatting with winners...</div>;
                
                return (
                  <div key={i} className={`flex flex-col ${msg.isHidden ? 'bg-indigo-50 p-1.5 rounded' : ''}`}>
                    <span className="font-bold text-xs text-slate-500">{msg.sender}</span>
                    <span className="text-slate-800 font-medium break-words">{msg.text}</span>
                  </div>
                );
              })}
            </div>
            <form onSubmit={(e) => {
              e.preventDefault();
              if(!guessInput.trim()) return;
              if(isHost) handleChat(guessInput, myPlayerId);
              else sendToHost({ type: 'CHAT_MESSAGE', payload: { text: guessInput, playerId: myPlayerId } });
              setGuessInput('');
            }} className="p-2 bg-slate-50 border-t border-slate-200 flex gap-2">
              <input type="text" placeholder={iAmDrawer ? "You cannot guess!" : myPlayerData.hasGuessed ? "Chat with winners..." : "Type your guess..."} disabled={iAmDrawer || myPlayerData.connected === false} className="flex-grow p-2 border border-slate-300 rounded outline-none focus:border-indigo-500 disabled:bg-slate-100 text-sm" value={guessInput} onChange={e => setGuessInput(e.target.value)} />
            </form>
          </div>
        </div>
      )}
    </div>
  );
}