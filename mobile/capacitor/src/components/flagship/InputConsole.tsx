import React, { useState } from 'react';

export default function InputConsole({ onSend, disabled }: {
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <div style={{
      padding: '12px 16px',
      background: '#eef0f5',
      boxShadow: '-6px -6px 16px rgba(255,255,255,0.8), 6px 6px 16px rgba(163,177,198,0.5)',
      borderRadius: '16px 16px 0 0',
      display: 'flex',
      gap: '10px',
      alignItems: 'center',
      flexShrink: 0,
    }}>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Message AVA007..."
        disabled={disabled}
        autoComplete="off"
        style={{
          flex: 1,
          padding: '12px 16px',
          border: 'none',
          borderRadius: '10px',
          background: '#eef0f5',
          color: '#3a3a4a',
          fontSize: '14px',
          fontFamily: 'inherit',
          outline: 'none',
          boxShadow: 'inset -4px -4px 10px rgba(255,255,255,0.8), inset 4px 4px 10px rgba(163,177,198,0.5)',
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(e); }}
      />
      <button
        onClick={handleSubmit}
        disabled={disabled || !text.trim()}
        style={{
          width: '44px',
          height: '44px',
          border: 'none',
          borderRadius: '10px',
          background: '#eef0f5',
          color: '#d4a72c',
          fontSize: '18px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '-6px -6px 16px rgba(255,255,255,0.8), 6px 6px 16px rgba(163,177,198,0.5)',
          opacity: disabled || !text.trim() ? 0.4 : 1,
        }}
      >
        ↑
      </button>
    </div>
  );
}
