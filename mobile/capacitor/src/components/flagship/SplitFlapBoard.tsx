import React from 'react';

export default function SplitFlapBoard({ text }: { text: string }) {
  const chars = text.toUpperCase().split('');

  return (
    <div style={{
      display: 'flex',
      gap: '3px',
      padding: '10px 14px',
      background: '#eef0f5',
      borderRadius: '10px',
      boxShadow: 'inset -4px -4px 10px rgba(255,255,255,0.8), inset 4px 4px 10px rgba(163,177,198,0.5)',
      overflow: 'hidden',
      justifyContent: 'center',
    }}>
      {chars.map((char, i) => (
        <div key={i} style={{
          width: '28px',
          height: '38px',
          background: 'linear-gradient(180deg, #2a2a3a 0%, #1a1a2a 50%, #2a2a3a 100%)',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#d4a72c',
          fontFamily: 'monospace',
          fontSize: '18px',
          fontWeight: 700,
          textShadow: '0 0 8px rgba(212,167,44,0.6)',
          boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.1)',
          borderBottom: '1px solid rgba(0,0,0,0.3)',
        }}>
          {char === ' ' ? '\u00A0' : char}
        </div>
      ))}
    </div>
  );
}
