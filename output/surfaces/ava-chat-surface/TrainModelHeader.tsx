import React from 'react';

interface TrainModelHeaderProps {
  connected: boolean;
  modelVersion?: string;
}

export const TrainModelHeader: React.FC<TrainModelHeaderProps> = ({
  connected,
  modelVersion = 'v0.1.0',
}) => {
  return (
    <div className="train-model-header">
      <div className="train-model-header__status">
        <span className={`train-model-header__indicator ${connected ? 'connected' : 'disconnected'}`} />
        <span className="train-model-header__label">
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      <div className="train-model-header__version">QAG MemBrain {modelVersion}</div>
      <div className="train-model-header__model">GRPO Training Active</div>
    </div>
  );
};
