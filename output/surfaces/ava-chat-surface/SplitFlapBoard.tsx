import React, { useState, useEffect } from 'react';

interface SplitFlapBoardProps {
  value: string;
  cellCount?: number;
}

const FLAP_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -:'.split('');

export const SplitFlapBoard: React.FC<SplitFlapBoardProps> = ({ value, cellCount = 20 }) => {
  const [display, setDisplay] = useState<string[]>([]);

  useEffect(() => {
    const padded = value.toUpperCase().padEnd(cellCount, ' ').slice(0, cellCount);
    setDisplay(padded.split(''));
  }, [value, cellCount]);

  return (
    <div className="split-flap-board">
      {display.map((char, i) => (
        <div key={i} className="split-flap-board__cell">
          <span className="split-flap-board__char">{char}</span>
        </div>
      ))}
    </div>
  );
};
