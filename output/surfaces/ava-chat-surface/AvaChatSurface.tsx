import React, { useState, useEffect, useCallback } from 'react';
import { InputConsole } from './InputConsole';
import { SocialGlassBar } from './SocialGlassBar';
import { TrainModelHeader } from './TrainModelHeader';

interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: number;
}

interface AvaChatSurfaceProps {
  wsUrl?: string;
  apiBaseUrl?: string;
}

export const AvaChatSurface: React.FC<AvaChatSurfaceProps> = ({
  wsUrl = 'ws://localhost:8080/timeline',
  apiBaseUrl = 'http://localhost:8080',
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'decision' && data.data) {
          setMessages((prev) => [
            ...prev,
            {
              id: data.data.id,
              role: 'agent',
              content: data.data.rationale || data.data.action,
              timestamp: Date.now(),
            },
          ]);
        }
      } catch {}
    };
    wsRef.current = ws;
    return () => ws.close();
  }, [wsUrl]);

  const handlePrompt = useCallback((prompt: string) => {
    setMessages((prev) => [
      ...prev,
      { id: `user_${Date.now()}`, role: 'user', content: prompt, timestamp: Date.now() },
    ]);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(prompt));
    }
  }, []);

  return (
    <div className="ava-chat-surface">
      <TrainModelHeader connected={connected} />
      <div className="ava-chat-surface__messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`ava-chat-surface__msg ava-chat-surface__msg--${msg.role}`}>
            <span className="ava-chat-surface__role">{msg.role === 'user' ? 'You' : 'Ava'}</span>
            <span className="ava-chat-surface__content">{msg.content}</span>
          </div>
        ))}
      </div>
      <SocialGlassBar />
      <InputConsole onPrompt={handlePrompt} disabled={!connected} />
    </div>
  );
};

import { useRef } from 'react';
