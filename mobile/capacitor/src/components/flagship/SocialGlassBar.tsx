import React from 'react';

export default function SocialGlassBar({ mode, onModeChange }: {
  mode: 'admin' | 'customer';
  onModeChange: (mode: 'admin' | 'customer') => void;
}) {
  return (
    <div style={{
      display: 'flex',
      gap: '4px',
      padding: '4px',
      borderRadius: '10px',
      background: '#eef0f5',
      boxShadow: 'inset -4px -4px 10px rgba(255,255,255,0.8), inset 4px 4px 10px rgba(163,177,198,0.5)',
    }}>
      {(['admin', 'customer'] as const).map((m) => (
        <button
          key={m}
          onClick={() => onModeChange(m)}
          style={{
            padding: '6px 14px',
            border: 'none',
            background: mode === m ? '#ffffff' : 'transparent',
            color: mode === m ? '#d4a72c' : '#8a8a9a',
            fontSize: '11px',
            fontWeight: 600,
            borderRadius: '6px',
            cursor: 'pointer',
            textTransform: 'capitalize',
            boxShadow: mode === m
              ? '-2px -2px 6px rgba(255,255,255,0.8), 2px 2px 6px rgba(163,177,198,0.5)'
              : 'none',
            transition: 'all 0.2s',
          }}
        >
          {m}
        </button>
      ))}
    </div>
  );
}
