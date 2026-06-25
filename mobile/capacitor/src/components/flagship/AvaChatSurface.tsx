import React from 'react';

export interface ChatMessage {
  role: 'user' | 'ava' | 'thinking' | 'error';
  text: string;
  time: string;
}

export default function AvaChatSurface({ messages }: { messages: ChatMessage[] }) {
  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: '20px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      scrollBehavior: 'smooth',
    }}>
      {messages.map((msg, i) => (
        <div key={i} style={{
          maxWidth: '80%',
          padding: '12px 16px',
          borderRadius: '16px',
          fontSize: '14px',
          lineHeight: 1.5,
          alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
          background: msg.role === 'user'
            ? 'rgba(212,167,44,0.12)'
            : msg.role === 'error'
            ? 'rgba(230,69,69,0.1)'
            : '#eef0f5',
          color: msg.role === 'error' ? '#e64545' : msg.role === 'thinking' ? '#8a8a9a' : '#3a3a4a',
          fontStyle: msg.role === 'thinking' ? 'italic' : 'normal',
          boxShadow: msg.role === 'user'
            ? 'inset -2px -2px 6px rgba(255,255,255,0.6), inset 3px 3px 8px rgba(212,167,44,0.4)'
            : msg.role === 'thinking' || msg.role === 'error'
            ? 'inset -4px -4px 10px rgba(255,255,255,0.8), inset 4px 4px 10px rgba(163,177,198,0.5)'
            : '-6px -6px 16px rgba(255,255,255,0.8), 6px 6px 16px rgba(163,177,198,0.5)',
          borderBottomLeftRadius: msg.role === 'user' ? '16px' : '4px',
          borderBottomRightRadius: msg.role === 'user' ? '4px' : '16px',
          animation: 'bubbleIn 0.3s ease',
        }}>
          {msg.text}
          <div style={{ fontSize: '10px', color: '#8a8a9a', marginTop: '4px' }}>{msg.time}</div>
        </div>
      ))}
      <style>{`
        @keyframes bubbleIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
