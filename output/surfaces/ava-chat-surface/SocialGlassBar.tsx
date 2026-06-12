import React from 'react';

interface SocialGlassBarProps {
  activeChannels?: string[];
}

export const SocialGlassBar: React.FC<SocialGlassBarProps> = ({
  activeChannels = ['beeper', 'a2a', 'nfc', 'lora'],
}) => {
  return (
    <div className="social-glass-bar">
      {activeChannels.map((ch) => (
        <div key={ch} className="social-glass-bar__channel">
          <span className="social-glass-bar__dot" />
          <span className="social-glass-bar__label">{ch}</span>
        </div>
      ))}
    </div>
  );
};
