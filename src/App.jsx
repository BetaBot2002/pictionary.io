import React, { useState, useEffect, useRef } from 'react';
import Peer from 'peerjs';

// --- Helpers & Constants ---
const generateShortId = () => Math.random().toString(36).substring(2, 8).toUpperCase();
const COLORS = ['#000000', '#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#EEEEEE'];
const FACES = ['😀', '😎', '🤪', '🥸', '🤖', '👽', '👻', '🤡'];
const RANDOM_NAMES = ["Bus Driver", "Pet Food", "Soggy Noodle", "Space Cowboy", "Night Owl"];
const SESSION_KEY = 'skribbl_p2p_session_v19';

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
  const [me, setMe] = useState(initSession.me || { 
    name: '', 
    color: COLORS[Math.floor(Math.random() * (COLORS.length - 1))], 
    face: FACES[Math.floor(Math.random() * FACES.length)] 
  });
  const [players, setPlayers] = useState(initSession.players || []);

  // --- Game Settings (Host Only) ---
  const [settings, setSettings] = useState(initSession.settings || { 
    maxPlayers: 8, 
    drawTime: 80, 
    rounds: 3, 
    wordCount: 3, 
    hints: 2, 
    customWords: '', 
    useOnlyCustom: false 
  });

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
  const [showInfoModal, setShowInfoModal] = useState(false); 
  
  const canvasRef = useRef(null);
  const contextRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [activeTool, setActiveTool] = useState('brush'); // 'brush' or 'fill'
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
      const response = await fetch('https://raw.githubusercontent.com/wlauyeung/Skribblio-Word-Bank/master/words_en_v1.0.0_raw.json');
      let words = await response.json();
      if (!Array.isArray(words)) {
         words = Object.values(words).flat();
      }
      return words;
    } catch (err) { 
      console.warn("Failed to fetch official Skribbl words:", err); 
      return FALLBACK_WORDS;
    }
  };

  const getUnusedWords = async (count) => {
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
        payload: { gameState, players, currentRound, drawerId, currentWord, timeLeft, settings, savedCanvas, chat, roomHostId }
      });
    }
  }, [gameState, players, currentRound, drawerId, currentWord, timeLeft, isHost, roomHostId, settings]);

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
        canvasRef.current.getContext('2d').fillStyle = '#EEEEEE';
        canvasRef.current.getContext('2d').fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
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
        setChat(data.payload.chat);
        applyCanvasState(data.payload.savedCanvas);
        break;
      case 'WORD_OPTIONS': setWordOptions(data.payload); break;
      case 'CHAT': setChat(prev => [...prev, data.payload]); break;
      case 'DRAW': 
        executeDrawCommand(data.payload); 
        if (data.payload.isNewStroke && canvasRef.current) setSavedCanvas(canvasRef.current.toDataURL());
        break;
      case 'FILL':
        executeFillCommand(data.payload);
        if (canvasRef.current) setSavedCanvas(canvasRef.current.toDataURL());
        break;
      case 'CLEAR_CANVAS': executeClear(); break;
      case 'ROOM_FULL':
        alert("The Host's room is currently full!");
        handleLeaveRoom();
        break;
      case 'ROOM_CLOSED': handleLeaveRoom(); break; 
      default: break;
    }
  };

  const handleHostReceiveData = (data, conn) => {
    switch (data.type) {
      case 'JOIN_LOBBY': {
        const state = stateRef.current;
        const exists = state.players.find(p => p.id === data.payload.id);
        const activeCount = state.players.filter(p => p.connected !== false).length;
        
        if (!exists && activeCount >= state.settings.maxPlayers) {
           conn.send({ type: 'ROOM_FULL' });
           return;
        }

        const msgText = exists ? `${data.payload.name} reconnected!` : `${data.payload.name} joined the room!`;
        const sysMsg = { sender: 'System', text: msgText, system: true, variant: exists ? 'success' : 'default' };
        
        const updatedChat = [...state.chat, sysMsg];
        setChat(updatedChat);
        broadcast({ type: 'CHAT', payload: sysMsg }, conn.peer);

        setPlayers(prev => {
          if (exists) return prev.map(p => p.id === data.payload.id ? { ...p, peerId: conn.peer, connected: true } : p);
          return [...prev, { ...data.payload, peerId: conn.peer, score: 0, hasGuessed: false, connected: true }];
        });
        
        if (state.gameState !== 'menu') {
          conn.send({ type: 'SYNC_STATE', payload: { ...state, chat: updatedChat } });
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
      case 'FILL':
        executeFillCommand(data.payload);
        if (canvasRef.current) setSavedCanvas(canvasRef.current.toDataURL());
        broadcast({ type: 'FILL', payload: data.payload }, conn.peer);
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
  const randomizeAvatar = () => setMe({ ...me, color: COLORS[Math.floor(Math.random() * (COLORS.length - 1))], face: FACES[Math.floor(Math.random() * FACES.length)] });
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
    if (active.length < 2 || active.length > settings.maxPlayers) return; 
    setPlayers(prev => prev.map(p => ({ ...p, score: 0, hasGuessed: false })));
    setCurrentRound(1);
    wordCache.current.forEach((_, key) => wordCache.current.set(key, false));
    startTurn(active[0].id);
  };

  const startTurn = async (nextDrawerId) => {
    const state = stateRef.current;
    const active = state.players.filter(p => p.connected !== false);
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
    
    const options = await getUnusedWords(state.settings.wordCount);
    
    setGameState('word_select');
    setTimeLeft(15); 

    if (nextDrawerId === myPlayerId) {
      setWordOptions(options);
    } else {
      const drawerClient = connsRef.current.find(c => state.players.find(p => p.id === nextDrawerId)?.peerId === c.peer);
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
      
      const allowedHints = state.settings.hints;
      const maxPossibleHints = Math.floor(state.currentWord.length / 2);
      const activeHints = Math.min(allowedHints, maxPossibleHints);
      
      const currentHintsRevealed = Math.floor((1 - (state.timeLeft / state.settings.drawTime)) * activeHints);
      
      let points = 300;
      if (activeHints > 0) {
        const penaltyPerHint = 300 / activeHints; 
        points = Math.floor(300 - (currentHintsRevealed * penaltyPerHint));
        points = Math.max(10, points); 
      }
      
      setPlayers(prev => {
        const updated = prev.map(p => {
          if (p.id === playerId) return { ...p, score: p.score + points, hasGuessed: true };
          if (p.id === state.drawerId) return { ...p, score: p.score + 50 }; 
          return p;
        });

        const activeNonDrawers = updated.filter(p => p.id !== state.drawerId && p.connected !== false);
        if (activeNonDrawers.length > 0 && activeNonDrawers.every(p => p.hasGuessed)) {
           setTimeout(() => endTurn(true), 100); 
        }
        return updated;
      });

      const sysMsg = { sender: 'System', text: `${player.name} guessed the word! (+${points}pts)`, system: true, variant: 'success' };
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
    setGameState('turn_end'); 
    
    let endText = `Time's up! The word was ${state.currentWord}`;
    if (forcedSkip) endText = "Drawer disconnected. Turn skipped!";
    else if (allGuessed) endText = `Everyone guessed it! The word was ${state.currentWord}`;
    
    const sysMsg = { sender: 'System', text: endText, system: true, variant: forcedSkip ? 'error' : (allGuessed ? 'success' : 'default') };
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
      let isNewRound = false;
      
      for (let i = 1; i <= latestState.players.length; i++) {
         const idx = (currentIndex + i) % latestState.players.length;
         if (idx <= currentIndex) isNewRound = true;

         if (latestState.players[idx].connected !== false) {
             nextPlayer = latestState.players[idx];
             break;
         }
      }

      if (isNewRound) {
        if (latestState.currentRound < latestState.settings.rounds) {
          setCurrentRound(prev => prev + 1);
          startTurn(nextPlayer.id);
        } else {
          setGameState('game_over');
        }
      } else {
        startTurn(nextPlayer.id);
      }
    }, 5000);
  };

  // ==========================================
  // 5. CANVAS & FLOOD FILL LOGIC
  // ==========================================
  useEffect(() => {
    if (gameState === 'drawing' && canvasRef.current) {
      const canvas = canvasRef.current;
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      const context = canvas.getContext("2d");
      context.lineCap = "round";
      context.lineJoin = "round";
      
      context.fillStyle = '#EEEEEE';
      context.fillRect(0, 0, canvas.width, canvas.height);
      contextRef.current = context;

      if (savedCanvas) {
        const img = new Image();
        img.src = savedCanvas;
        img.onload = () => context.drawImage(img, 0, 0);
      }
    }
  }, [gameState]);

  // Convert Hex string to RGBA for pixel manipulation
  const hexToRgba = (hex) => {
    const bigint = parseInt(hex.startsWith('#') ? hex.slice(1) : hex, 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255, 255];
  };

  // Optimized Flood Fill algorithm
  const executeFillCommand = ({ x, y, color }) => {
    if (!canvasRef.current || !contextRef.current) return;
    const canvas = canvasRef.current;
    const ctx = contextRef.current;
    
    const width = canvas.width;
    const height = canvas.height;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    
    const startX = Math.floor(x);
    const startY = Math.floor(y);
    const startPos = (startY * width + startX) * 4;
    
    const startR = data[startPos];
    const startG = data[startPos + 1];
    const startB = data[startPos + 2];
    const startA = data[startPos + 3];
    
    const fillRgba = hexToRgba(color);
    
    const tolerance = 50; 
    const colorMatch = (pos) => {
      return Math.abs(data[pos] - startR) <= tolerance &&
             Math.abs(data[pos + 1] - startG) <= tolerance &&
             Math.abs(data[pos + 2] - startB) <= tolerance &&
             Math.abs(data[pos + 3] - startA) <= tolerance;
    };

    if (Math.abs(startR - fillRgba[0]) <= tolerance &&
        Math.abs(startG - fillRgba[1]) <= tolerance &&
        Math.abs(startB - fillRgba[2]) <= tolerance) {
      return; 
    }

    const pixelStack = [[startX, startY]];
    
    while (pixelStack.length) {
      const newPos = pixelStack.pop();
      const px = newPos[0];
      let py = newPos[1];
      
      let pixelPos = (py * width + px) * 4;
      while (py-- >= 0 && colorMatch(pixelPos)) {
        pixelPos -= width * 4;
      }
      pixelPos += width * 4;
      ++py;
      
      let reachLeft = false;
      let reachRight = false;
      
      while (py++ < height - 1 && colorMatch(pixelPos)) {
        data[pixelPos] = fillRgba[0];
        data[pixelPos + 1] = fillRgba[1];
        data[pixelPos + 2] = fillRgba[2];
        data[pixelPos + 3] = 255; 
        
        if (px > 0) {
          if (colorMatch(pixelPos - 4)) {
            if (!reachLeft) {
              pixelStack.push([px - 1, py]);
              reachLeft = true;
            }
          } else if (reachLeft) {
            reachLeft = false;
          }
        }
        
        if (px < width - 1) {
          if (colorMatch(pixelPos + 4)) {
            if (!reachRight) {
              pixelStack.push([px + 1, py]);
              reachRight = true;
            }
          } else if (reachRight) {
            reachRight = false;
          }
        }
        pixelPos += width * 4;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  };

  const startDrawing = (e) => {
    if (myPlayerId !== drawerId) return;
    const { offsetX, offsetY } = e.nativeEvent;

    // Trigger fill if paint bucket is active
    if (activeTool === 'fill') {
      executeFillCommand({ x: offsetX, y: offsetY, color: brushColor });
      const payload = { x: offsetX, y: offsetY, color: brushColor };
      if (isHost) broadcast({ type: 'FILL', payload });
      else sendToHost({ type: 'FILL', payload });

      if (canvasRef.current) setSavedCanvas(canvasRef.current.toDataURL());
      return;
    }

    contextRef.current.beginPath();
    contextRef.current.moveTo(offsetX, offsetY);
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing || myPlayerId !== drawerId || activeTool !== 'brush') return;
    const { offsetX, offsetY } = e.nativeEvent;
    executeDrawCommand({ x: offsetX, y: offsetY, color: brushColor, size: brushSize, isNewStroke: false });
    const payload = { x: offsetX, y: offsetY, color: brushColor, size: brushSize, isNewStroke: false };
    if (isHost) broadcast({ type: 'DRAW', payload });
    else sendToHost({ type: 'DRAW', payload });
  };

  const stopDrawing = () => {
    if (myPlayerId !== drawerId || activeTool !== 'brush') return;
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
    const canvas = canvasRef.current;
    const context = contextRef.current;
    context.fillStyle = '#EEEEEE';
    context.fillRect(0, 0, canvas.width, canvas.height);
    setSavedCanvas(null);
  };

  // ==========================================
  // UI HELPERS & RENDERING
  // ==========================================
  const renderHint = () => {
    if (!currentWord) return "";
    if (myPlayerId === drawerId || gameState === 'turn_end' || gameState === 'game_over') return currentWord;
    
    const allowedHints = settings.hints;
    const maxPossibleHints = Math.floor(currentWord.length / 2);
    const activeHints = Math.min(allowedHints, maxPossibleHints);
    
    const revealCount = Math.floor((1 - (timeLeft / settings.drawTime)) * activeHints);
    return currentWord.split('').map((char, index) => 
      (char === ' ' ? '  ' : (index < revealCount ? char : '_'))
    ).join(' ');
  };

  const renderPodium = () => {
    const sortedPlayers = [...players].sort((a,b) => b.score - a.score);
    const top3 = sortedPlayers.slice(0, 3);
    const others = sortedPlayers.slice(3);

    const podiumBlocks = [];
    if (top3[1]) podiumBlocks.push({ ...top3[1], rank: 2, height: 'h-24 md:h-32', color: 'bg-[#94A3B8]' }); // Silver
    if (top3[0]) podiumBlocks.push({ ...top3[0], rank: 1, height: 'h-32 md:h-48', color: 'bg-[#F59E0B]' }); // Gold
    if (top3[2]) podiumBlocks.push({ ...top3[2], rank: 3, height: 'h-16 md:h-24', color: 'bg-[#D97706]' }); // Bronze

    return (
      <div className="flex flex-col items-center w-full max-w-2xl px-4">
        <div className="flex items-end justify-center gap-2 md:gap-4 mt-8 w-full">
          {podiumBlocks.map(p => (
            <div key={p.id} className="flex flex-col items-center">
              <div className={`w-12 h-12 md:w-16 md:h-16 rounded-full flex items-center justify-center text-2xl md:text-4xl mb-2 z-10 relative shadow-lg border-2 border-[#222831] ${p.connected === false ? 'grayscale opacity-50' : ''}`} style={{ backgroundColor: p.color }}>{p.face}</div>
              <div className="font-bold text-[#EEEEEE] text-sm md:text-base truncate w-20 md:w-28 text-center">{p.name}</div>
              <div className="text-[#00ADB5] font-black text-lg md:text-xl mb-1">{p.score}</div>
              <div className={`w-20 md:w-28 ${p.height} ${p.color} rounded-t-lg flex justify-center pt-2 md:pt-4 text-3xl md:text-5xl font-black text-[#222831]/40 shadow-inner`}>{p.rank}</div>
            </div>
          ))}
        </div>
        {others.length > 0 && (
          <div className="mt-8 flex flex-col gap-2 w-full max-w-md">
            {others.map((p, i) => (
              <div key={p.id} className={`flex items-center gap-4 bg-[#393E46] border border-[#222831] px-6 py-3 rounded-xl w-full text-[#EEEEEE] ${p.connected === false ? 'opacity-50' : ''}`}>
                <div className="text-xl font-black w-8 text-[#EEEEEE]/50">#{i + 4}</div>
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0 grayscale-0 border border-[#222831]" style={{ backgroundColor: p.color }}>{p.face}</div>
                <div className="text-lg font-bold flex-grow truncate">{p.name}</div>
                <div className="text-xl font-black text-[#00ADB5]">{p.score}</div>
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
    <div className="min-h-screen bg-[#222831] flex flex-col font-sans text-[#EEEEEE] relative">
      
      {/* INFO SCORING MODAL */}
      {showInfoModal && (
        <div className="absolute inset-0 bg-[#222831]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#393E46] border border-[#00ADB5]/50 p-6 rounded-xl max-w-md w-full shadow-2xl relative text-[#EEEEEE]">
            <button onClick={() => setShowInfoModal(false)} className="absolute top-4 right-4 text-[#EEEEEE]/50 hover:text-[#EEEEEE] font-bold text-xl cursor-pointer">✖</button>
            <h2 className="text-2xl font-black mb-6 text-[#00ADB5] border-b border-[#222831] pb-2">How to Play & Scoring</h2>
            <ul className="space-y-4 text-sm">
              <li>
                <strong className="text-[#EEEEEE] block text-base mb-1">🔄 What is a Round?</strong>
                A round consists of <strong>every player taking one turn to draw</strong> while the others guess. The game ends when all rounds are completed.
              </li>
              <li>
                <strong className="text-[#EEEEEE] block text-base mb-1">🎯 Guessers (Hint Tiers)</strong>
                You earn points based on how many letters were hidden when you guessed! Guessing before any letters are revealed gives you <strong>300 points</strong>. For every hint revealed, your potential score drops proportionally.
              </li>
              <li>
                <strong className="text-[#EEEEEE] block text-base mb-1">🖌️ The Drawer</strong>
                You earn a bonus <strong>+50 points</strong> for <em>each</em> player who successfully guesses your drawing.
              </li>
            </ul>
            <button onClick={() => setShowInfoModal(false)} className="mt-8 w-full bg-[#00ADB5] hover:bg-[#00939b] text-[#EEEEEE] font-bold py-3 rounded-lg transition-colors cursor-pointer shadow">Got it!</button>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="bg-[#393E46] p-3 shadow-sm border-b border-[#222831] flex flex-wrap justify-between items-center z-10 gap-2">
        <h1 className="text-2xl font-black tracking-tight text-[#EEEEEE]">Pictionary<span className="text-[#00ADB5]">.io</span></h1>
        
        {gameState !== 'menu' ? (
          <div className="flex flex-wrap items-center gap-4 text-sm font-bold">
            <div className="hidden md:flex items-center gap-2 bg-[#222831] px-3 py-1.5 rounded-lg border border-[#00ADB5]/30">
              <span className="text-[#EEEEEE]/80">Room Code: <span className="font-mono text-[#EEEEEE]">{roomHostId === myPlayerId ? myPeerId : joinId}</span></span>
              <button onClick={() => copyToClipboard('code')} className="text-xs bg-[#393E46] hover:bg-[#222831] text-[#00ADB5] border border-[#00ADB5]/50 px-2 py-1 rounded transition-colors cursor-pointer">
                {copiedType === 'code' ? 'Copied!' : 'Copy'}
              </button>
              <button onClick={() => copyToClipboard('link')} className="text-xs bg-[#00ADB5] hover:bg-[#00939b] text-[#EEEEEE] px-2 py-1 rounded transition-colors cursor-pointer">
                {copiedType === 'link' ? 'Copied Link!' : 'Invite Link'}
              </button>
            </div>
            
            <div className="text-[#EEEEEE]/80 bg-[#222831] px-3 py-1.5 rounded-lg">Round {currentRound} / {settings.rounds}</div>
            
            <div className={`text-lg bg-[#222831] px-3 py-1 rounded-lg ${timeLeft <= 10 ? 'text-red-400 animate-pulse bg-red-400/10' : 'text-[#EEEEEE]'}`}>
              ⏱ {timeLeft}s
            </div>

            <button onClick={() => setShowInfoModal(true)} className="bg-[#222831] hover:bg-[#1a1e25] text-[#00ADB5] border border-[#00ADB5]/50 w-8 h-8 rounded-full flex items-center justify-center font-bold transition-colors cursor-pointer shadow" title="Scoring Info">
              ?
            </button>

            {isHost ? (
               <div className="flex gap-2">
                 <button onClick={handleLeaveRoom} className="bg-[#222831] hover:bg-[#1a1e25] text-[#EEEEEE] border border-[#393E46] px-3 py-1.5 rounded-lg transition-colors cursor-pointer">
                   Leave
                 </button>
                 <button onClick={closeRoomEntirely} className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 px-3 py-1.5 rounded-lg transition-colors cursor-pointer shadow-sm">
                   Close Room
                 </button>
               </div>
            ) : (
              <button onClick={handleLeaveRoom} className="bg-[#222831] hover:bg-[#1a1e25] text-[#EEEEEE] border border-[#393E46] px-3 py-1.5 rounded-lg transition-colors cursor-pointer">
                Leave
              </button>
            )}
          </div>
        ) : (
          <button onClick={() => setShowInfoModal(true)} className="bg-[#222831] hover:bg-[#1a1e25] text-[#00ADB5] border border-[#00ADB5]/50 w-8 h-8 rounded-full flex items-center justify-center font-bold transition-colors cursor-pointer shadow ml-auto" title="Scoring Info">
            ?
          </button>
        )}
      </header>

      {gameState === 'menu' && (
        <div className="flex-grow flex items-center justify-center p-4">
          <div className="bg-[#393E46] p-8 rounded-2xl shadow-xl w-full max-w-sm border border-[#222831] text-center">
            <div className="mb-6 relative w-32 h-32 mx-auto rounded-full border-4 shadow-inner flex items-center justify-center text-6xl border-[#222831]" style={{ backgroundColor: me.color }}>
              {me.face}
              <button onClick={randomizeAvatar} className="absolute -bottom-2 -right-2 bg-[#00ADB5] hover:bg-[#00939b] text-[#EEEEEE] text-sm p-2 rounded-full shadow cursor-pointer">🎲</button>
            </div>
            <input type="text" placeholder="Enter your name" className="w-full p-3 border-2 border-[#222831] bg-[#222831] text-[#EEEEEE] rounded-xl mb-6 focus:border-[#00ADB5] outline-none text-center font-bold text-lg placeholder-[#EEEEEE]/50" value={me.name} onChange={(e) => setMe({ ...me, name: e.target.value })} />
            <div className="space-y-3">
              <button onClick={hostGame} disabled={!myPeerId} className="w-full bg-[#00ADB5] hover:bg-[#00939b] text-[#EEEEEE] font-black py-4 rounded-xl shadow-[0_4px_0_#007a80] active:shadow-none active:translate-y-1 transition-all text-lg cursor-pointer">
                Create Private Room
              </button>
              <div className="flex gap-2 pt-2">
                <input type="text" placeholder="Paste Code" className="flex-grow p-3 border-2 border-[#222831] bg-[#222831] text-[#EEEEEE] rounded-xl focus:border-[#00ADB5] outline-none text-center font-mono uppercase placeholder-[#EEEEEE]/50" value={joinId} onChange={(e) => setJoinId(e.target.value.toUpperCase())} />
                <button onClick={joinGame} disabled={!joinId || !myPeerId} className="bg-[#222831] hover:bg-[#1a1e25] text-[#EEEEEE] border border-[#222831] font-bold px-6 rounded-xl shadow-[0_4px_0_#1a1e25] active:shadow-none active:translate-y-1 transition-all cursor-pointer">
                  Join
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {gameState === 'lobby' && (
        <div className="flex-grow flex flex-col items-center justify-center p-4">
          <div className="bg-[#393E46] p-8 rounded-2xl shadow-xl w-full max-w-4xl border border-[#222831] flex flex-col md:flex-row gap-8">
            <div className="flex-grow">
              <h2 className="text-2xl font-black mb-4 flex justify-between items-center text-[#EEEEEE]">
                Lobby <span className="text-sm font-normal bg-[#222831] px-3 py-1 rounded-full text-[#EEEEEE]/80">{players.filter(p=>p.connected!==false).length} / {settings.maxPlayers} Players</span>
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {players.map(p => (
                  <div key={p.id} className={`flex flex-col items-center p-3 rounded-xl border ${p.connected === false ? 'bg-[#393E46] border-[#222831] opacity-50 grayscale' : 'bg-[#222831] border-[#222831]'}`}>
                    <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl shadow-sm mb-2 border border-[#393E46]" style={{ backgroundColor: p.color }}>{p.face}</div>
                    <span className="font-bold text-sm w-full text-center truncate text-[#EEEEEE]">
                      {p.name || "Unknown Player"} {p.id === myPlayerId ? <span className="text-[#00ADB5]">(You)</span> : ''}
                    </span>
                    {p.connected === false && <span className="text-xs font-bold text-red-400 mt-1">Disconnected</span>}
                  </div>
                ))}
              </div>
            </div>

            {isHost ? (
              <div className="w-full md:w-80 bg-[#222831] p-6 rounded-xl border border-[#222831]">
                <h3 className="font-bold mb-4 text-[#EEEEEE] uppercase tracking-wide text-sm">Room Settings</h3>
                
                <label className="block text-sm font-bold text-[#EEEEEE]/80 mb-1">Max Players: {settings.maxPlayers}</label>
                <input type="range" min="2" max="12" value={settings.maxPlayers} onChange={e => setSettings({...settings, maxPlayers: Number(e.target.value)})} className="w-full mb-4 accent-[#00ADB5] cursor-pointer" />

                <label className="block text-sm font-bold text-[#EEEEEE]/80 mb-1">Rounds: {settings.rounds}</label>
                <input type="range" min="1" max="10" value={settings.rounds} onChange={e => setSettings({...settings, rounds: Number(e.target.value)})} className="w-full mb-4 accent-[#00ADB5] cursor-pointer" />

                <label className="block text-sm font-bold text-[#EEEEEE]/80 mb-1">Draw Time: {settings.drawTime}s</label>
                <input type="range" min="30" max="180" step="10" value={settings.drawTime} onChange={e => setSettings({...settings, drawTime: Number(e.target.value)})} className="w-full mb-4 accent-[#00ADB5] cursor-pointer" />

                <label className="block text-sm font-bold text-[#EEEEEE]/80 mb-1">Word Choices: {settings.wordCount}</label>
                <input type="range" min="2" max="5" value={settings.wordCount} onChange={e => setSettings({...settings, wordCount: Number(e.target.value)})} className="w-full mb-4 accent-[#00ADB5] cursor-pointer" />

                <label className="block text-sm font-bold text-[#EEEEEE]/80 mb-1">Hints Allowed: {settings.hints}</label>
                <input type="range" min="0" max="5" value={settings.hints} onChange={e => setSettings({...settings, hints: Number(e.target.value)})} className="w-full mb-4 accent-[#00ADB5] cursor-pointer" />

                <label className="block text-sm font-bold text-[#EEEEEE]/80 mb-1">Custom Words</label>
                <textarea rows="2" className="w-full p-2 border border-[#393E46] bg-[#393E46] text-[#EEEEEE] rounded-lg mb-2 text-sm outline-none focus:border-[#00ADB5] placeholder-[#EEEEEE]/40" value={settings.customWords} onChange={e => setSettings({...settings, customWords: e.target.value})} placeholder="dog, cat, laser..." />
                
                <label className="flex items-center gap-2 text-sm font-bold text-[#EEEEEE]/80 mb-6 cursor-pointer">
                  <input type="checkbox" checked={settings.useOnlyCustom} onChange={e => setSettings({...settings, useOnlyCustom: e.target.checked})} className="w-4 h-4 accent-[#00ADB5]" /> Use custom words exclusively
                </label>
                
                <div className="p-4 bg-[#393E46] border border-[#222831] rounded-lg mb-4 text-center">
                  <span className="text-xs text-[#00ADB5] block mb-1 font-bold">INVITE CODE</span>
                  <strong className="text-3xl tracking-widest font-mono text-[#EEEEEE] block mb-3">{myPeerId}</strong>
                  <div className="flex gap-2 justify-center">
                    <button onClick={() => copyToClipboard('code')} className="flex-1 bg-[#222831] hover:bg-[#1a1e25] text-[#00ADB5] font-bold py-2 rounded text-sm transition-colors cursor-pointer border border-[#00ADB5]/30">
                      {copiedType === 'code' ? 'Copied!' : 'Copy Code'}
                    </button>
                    <button onClick={() => copyToClipboard('link')} className="flex-1 bg-[#00ADB5] hover:bg-[#00939b] text-[#EEEEEE] font-bold py-2 rounded text-sm transition-colors cursor-pointer">
                      {copiedType === 'link' ? 'Copied Link!' : 'Copy Link'}
                    </button>
                  </div>
                </div>

                <div className="flex gap-2 mb-4">
                  <button onClick={handleLeaveRoom} className="flex-1 bg-[#393E46] hover:bg-[#222831] text-[#EEEEEE] font-bold py-2 rounded-xl transition-colors cursor-pointer">Leave</button>
                  <button onClick={closeRoomEntirely} className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold py-2 rounded-xl transition-colors cursor-pointer">Close Room</button>
                </div>

                <button 
                  onClick={startGame} 
                  disabled={players.filter(p=>p.connected!==false).length < 2 || players.filter(p=>p.connected!==false).length > settings.maxPlayers}
                  className={`w-full font-black py-3 rounded-xl transition-all ${players.filter(p=>p.connected!==false).length < 2 || players.filter(p=>p.connected!==false).length > settings.maxPlayers ? 'bg-[#393E46] text-[#EEEEEE]/50 cursor-not-allowed' : 'bg-[#00ADB5] hover:bg-[#00939b] text-[#EEEEEE] shadow-[0_4px_0_#007a80] active:translate-y-1 cursor-pointer'}`}
                >
                  {players.filter(p=>p.connected!==false).length < 2 ? 'Need 2+ Online' : players.filter(p=>p.connected!==false).length > settings.maxPlayers ? 'Room Over Capacity' : 'Start Game'}
                </button>
              </div>
            ) : (
              <div className="w-full md:w-80 flex flex-col items-center justify-center text-[#EEEEEE]/50 p-8 text-center bg-[#222831] rounded-xl border border-[#222831]">
                <div className="text-4xl mb-4 animate-spin text-[#00ADB5]">⏳</div>
                <p className="font-bold text-lg text-[#EEEEEE]">Waiting for Host...</p>
                <p className="text-sm mb-4">Status: {networkStatus}</p>
                <button onClick={handleLeaveRoom} className="bg-red-500/10 text-red-400 px-4 py-2 rounded font-bold hover:bg-red-500/20 transition-colors cursor-pointer">Leave Lobby</button>
              </div>
            )}
          </div>
        </div>
      )}

      {(gameState === 'word_select' || gameState === 'drawing' || gameState === 'turn_end' || gameState === 'game_over') && (
        <div className="flex-grow flex flex-col lg:flex-row max-w-[1400px] mx-auto w-full p-4 gap-4">
          
          {/* Left Panel: Players */}
          <div className="w-full lg:w-48 flex flex-row lg:flex-col gap-2 overflow-x-auto lg:overflow-y-auto order-2 lg:order-1 shrink-0">
            {[...players].sort((a,b) => b.score - a.score).map((p, idx) => (
              <div key={p.id} className={`flex items-center gap-3 p-2 rounded-lg border-2 min-w-[160px] ${p.connected === false ? 'opacity-50 grayscale bg-[#393E46] border-[#222831]' : p.id === drawerId ? 'bg-[#222831] border-[#00ADB5]' : p.hasGuessed ? 'bg-[#00ADB5]/20 border-[#00ADB5]/50' : 'bg-[#393E46] border-[#222831]'}`}>
                <div className="font-black text-[#EEEEEE]/50 w-4 text-center">#{idx + 1}</div>
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0 border border-[#222831]" style={{ backgroundColor: p.color }}>{p.face}</div>
                <div className="flex flex-col overflow-hidden">
                  <span className={`font-bold text-sm truncate text-[#EEEEEE] ${p.connected === false ? 'line-through text-red-400' : ''}`}>{p.name} {p.id === myPlayerId ? <span className="text-[#00ADB5]">(You)</span> : ''}</span>
                  <span className={`text-xs ${p.id === drawerId ? 'text-[#00ADB5]' : 'text-[#EEEEEE]/70'}`}>{p.score} pts</span>
                </div>
              </div>
            ))}
          </div>

          {/* Center Panel: Canvas */}
          <div className="flex-grow flex flex-col min-w-0 bg-[#393E46] rounded-xl shadow-sm border border-[#222831] order-1 lg:order-2 overflow-hidden relative">
            <div className="bg-[#222831] border-b border-[#222831] p-3 text-center">
              <div className={`font-mono font-bold tracking-[0.5em] text-2xl uppercase ${gameState === 'turn_end' ? 'text-[#00ADB5]' : 'text-[#EEEEEE]'}`}>{renderHint()}</div>
            </div>

            <div className="flex-grow relative bg-[#EEEEEE] cursor-crosshair h-[400px] lg:h-auto">
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full touch-none bg-[#EEEEEE]" onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing} />

              {gameState === 'word_select' && (
                <div className="absolute inset-0 bg-[#222831]/95 backdrop-blur-sm flex items-center justify-center z-20">
                  {iAmDrawer ? (
                    <div className="text-center">
                      <h2 className="text-3xl font-black mb-6 text-[#EEEEEE]">Choose a word</h2>
                      <div className="flex gap-4 justify-center">
                        {wordOptions.map(w => (
                          <button key={w} onClick={() => { if(isHost) hostWordChosen(w); else sendToHost({ type: 'WORD_CHOSEN', payload: w }); }} className="bg-[#00ADB5] hover:bg-[#00939b] text-[#EEEEEE] font-bold text-xl py-4 px-8 rounded-xl shadow-[0_4px_0_#007a80] active:translate-y-1 transition-all uppercase cursor-pointer">{w}</button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center text-[#EEEEEE]/70"><div className="text-5xl mb-4 animate-bounce">🤔</div><h2 className="text-2xl font-bold">The Drawer is choosing a word...</h2></div>
                  )}
                </div>
              )}

              {gameState === 'turn_end' && (
                <div className="absolute inset-0 bg-[#222831]/95 backdrop-blur-sm flex flex-col items-center justify-center z-20 text-center">
                  <h2 className="text-4xl font-black mb-2 text-[#EEEEEE]">Turn Over!</h2>
                  <p className="text-2xl text-[#00ADB5] mb-4 font-bold">{chat[chat.length-1]?.text || 'Loading next turn...'}</p>
                </div>
              )}

              {gameState === 'game_over' && (
                <div className="absolute inset-0 bg-[#222831]/95 backdrop-blur-md flex flex-col items-center justify-center z-30 overflow-y-auto py-8">
                  <h1 className="text-5xl md:text-6xl font-black mb-2 text-[#00ADB5] drop-shadow-lg">Game Over!</h1>
                  <p className="text-[#EEEEEE]/80 font-medium mb-4">Final Standings</p>
                  
                  {renderPodium()}

                  <div className="mt-12 flex gap-4">
                    {isHost ? (
                      <>
                        <button onClick={handleLeaveRoom} className="bg-[#393E46] hover:bg-[#1a1e25] px-8 py-4 rounded-xl font-bold text-[#EEEEEE] border border-[#222831] shadow-lg active:scale-95 transition-all cursor-pointer">Leave</button>
                        <button onClick={closeRoomEntirely} className="bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 px-8 py-4 rounded-xl font-bold shadow-lg active:scale-95 transition-all cursor-pointer">Close Room</button>
                      </>
                    ) : (
                      <button onClick={handleLeaveRoom} className="bg-[#393E46] hover:bg-[#1a1e25] px-8 py-4 rounded-xl font-bold text-[#EEEEEE] border border-[#222831] shadow-lg active:scale-95 transition-all cursor-pointer">Leave Room</button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {iAmDrawer && gameState === 'drawing' && (
              <div className="bg-[#222831] border-t border-[#222831] p-2 flex gap-4 justify-center items-center">
                
                {/* TOOL SELECTOR: Brush vs Fill */}
                <div className="flex gap-2 bg-[#393E46] p-1 rounded-lg border border-[#222831]">
                  <button onClick={() => setActiveTool('brush')} className={`px-2 py-1 rounded text-xl transition-colors cursor-pointer ${activeTool === 'brush' ? 'bg-[#00ADB5] text-[#EEEEEE]' : 'text-[#EEEEEE]/50 hover:bg-[#222831]'}`} title="Brush">🖌️</button>
                  <button onClick={() => setActiveTool('fill')} className={`px-2 py-1 rounded text-xl transition-colors cursor-pointer ${activeTool === 'fill' ? 'bg-[#00ADB5] text-[#EEEEEE]' : 'text-[#EEEEEE]/50 hover:bg-[#222831]'}`} title="Fill">🪣</button>
                </div>
                <div className="w-px h-8 bg-[#393E46]"></div>

                <div className="flex flex-wrap gap-2 justify-center max-w-[200px] md:max-w-none">
                  {COLORS.map(c => <button key={c} onClick={() => setBrushColor(c)} className={`w-8 h-8 rounded-full border-2 shadow-sm cursor-pointer ${brushColor === c ? 'border-[#00ADB5] scale-110' : 'border-[#393E46]'}`} style={{ backgroundColor: c }} />)}
                </div>
                <div className="w-px h-8 bg-[#393E46]"></div>
                <input type="range" min="2" max="40" value={brushSize} onChange={e => setBrushSize(e.target.value)} className="w-24 accent-[#00ADB5] cursor-pointer" />
                <div className="w-px h-8 bg-[#393E46]"></div>
                <button onClick={reqClearCanvas} className="bg-[#393E46] hover:bg-[#1a1e25] text-[#EEEEEE] font-bold p-2 rounded-lg cursor-pointer border border-[#222831]" title="Trash / Clear">🗑️</button>
              </div>
            )}
          </div>

          {/* Right Panel: Chat */}
          <div className="w-full lg:w-72 flex flex-col bg-[#393E46] rounded-xl shadow-sm border border-[#222831] h-64 lg:h-auto order-3 shrink-0 overflow-hidden">
            <div className="bg-[#222831] p-3 border-b border-[#222831] font-bold text-[#EEEEEE]">Chat & Guesses</div>
            <div className="flex-grow overflow-y-auto p-3 flex flex-col gap-1.5 text-sm">
              {chat.map((msg, i) => {
                if (msg.system) {
                  let bgColor = 'bg-[#00ADB5]/10';
                  let textColor = 'text-[#00ADB5]';
                  if (msg.variant === 'success') { bgColor = 'bg-emerald-400/10'; textColor = 'text-emerald-400'; }
                  if (msg.variant === 'error') { bgColor = 'bg-red-400/10'; textColor = 'text-red-400'; }
                  if (msg.variant === 'warning') { bgColor = 'bg-amber-400/10'; textColor = 'text-amber-400'; }
                  return <div key={i} className={`${textColor} font-bold text-center ${bgColor} py-1.5 rounded my-1 shadow-sm`}>{msg.text}</div>;
                }
                
                if (msg.isHidden && !myPlayerData.hasGuessed && !iAmDrawer) return <div key={i} className="text-[#EEEEEE]/50 italic">🔒 <span className="font-bold">{msg.sender}</span> is chatting with winners...</div>;
                
                return (
                  <div key={i} className={`flex flex-col ${msg.isHidden ? 'bg-[#00ADB5]/20 p-1.5 rounded border border-[#00ADB5]/30' : ''}`}>
                    <span className="font-bold text-xs text-[#EEEEEE]/60">{msg.sender}</span>
                    <span className="text-[#EEEEEE] font-medium break-words">{msg.text}</span>
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
            }} className="p-2 bg-[#222831] border-t border-[#222831] flex gap-2">
              <input type="text" placeholder={iAmDrawer ? "You cannot guess!" : myPlayerData.hasGuessed ? "Chat with winners..." : "Type your guess..."} disabled={iAmDrawer || myPlayerData.connected === false} className="flex-grow p-2 border border-[#393E46] bg-[#393E46] rounded outline-none focus:border-[#00ADB5] disabled:opacity-50 text-sm text-[#EEEEEE] placeholder-[#EEEEEE]/50" value={guessInput} onChange={e => setGuessInput(e.target.value)} />
            </form>
          </div>
        </div>
      )}
    </div>
  );
}