import React from 'react';

export default function AtlantaWeather({ temp, condition }: {
  temp?: number;
  condition?: string;
}) {
  // Default to Atlanta weather mockup
  const t = temp ?? 72;
  const c = condition ?? 'Partly Cloudy';

  return (
    <div style={{
      padding: '10px 14px',
      background: '#eef0f5',
      borderRadius: '10px',
      boxShadow: '-6px -6px 16px rgba(255,255,255,0.8), 6px 6px 16px rgba(163,177,198,0.5)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '12px',
    }}>
      <span style={{ fontSize: '20px' }}>⛅</span>
      <div>
        <div style={{ color: '#3a3a4a', fontWeight: 600 }}>{t}°F Atlanta</div>
        <div style={{ color: '#8a8a9a', fontSize: '10px' }}>{c}</div>
      </div>
    </div>
  );
}
