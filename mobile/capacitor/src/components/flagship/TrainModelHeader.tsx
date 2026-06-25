import React from 'react';

export default function TrainModelHeader({ model, status, tokensPerSec }: {
  model: string;
  status: 'live' | 'loading' | 'offline';
  tokensPerSec?: number;
}) {
  const statusColor = status === 'live' ? '#4caf50' : status === 'loading' ? '#d4a72c' : '#e64545';
  const statusLabel = status === 'live' ? 'LIVE' : status === 'loading' ? 'LOADING' : 'OFFLINE';

  return (
    <div style={{
      padding: '14px 20px',
      background: '#eef0f5',
      borderRadius: '0 0 16px 16px',
      boxShadow: '-6px -6px 16px rgba(255,255,255,0.8), 6px 6px 16px rgba(163,177,198,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexShrink: 0,
      zIndex: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          fontSize: '20px',
          fontWeight: 800,
          letterSpacing: '-0.02em',
          color: '#3a3a4a',
        }}>
          AVA007
        </div>
        <div style={{
          fontSize: '10px',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: statusColor,
          padding: '3px 10px',
          borderRadius: '999px',
          background: '#eef0f5',
          boxShadow: 'inset -4px -4px 10px rgba(255,255,255,0.8), inset 4px 4px 10px rgba(163,177,198,0.5)',
        }}>
          {statusLabel}
        </div>
      </div>
      <div style={{
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        fontSize: '11px',
        color: '#8a8a9a',
      }}>
        <span style={{
          padding: '4px 10px',
          borderRadius: '8px',
          background: '#eef0f5',
          boxShadow: 'inset -4px -4px 10px rgba(255,255,255,0.8), inset 4px 4px 10px rgba(163,177,198,0.5)',
        }}>
          {model}
        </span>
        {tokensPerSec !== undefined && (
          <span style={{
            padding: '4px 10px',
            borderRadius: '8px',
            background: '#eef0f5',
            color: '#d4a72c',
            fontWeight: 600,
            boxShadow: 'inset -2px -2px 6px rgba(255,255,255,0.6), inset 3px 3px 8px rgba(212,167,44,0.3)',
          }}>
            {tokensPerSec.toFixed(1)} tok/s
          </span>
        )}
      </div>
    </div>
  );
}
