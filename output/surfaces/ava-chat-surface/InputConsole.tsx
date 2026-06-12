import React, { useState, useRef, useEffect } from 'react';

interface InputConsoleProps {
  onPrompt: (prompt: string) => void;
  disabled?: boolean;
}

export const InputConsole: React.FC<InputConsoleProps> = ({ onPrompt, disabled = false }) => {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onPrompt(trimmed);
    setInput('');
  };

  return (
    <form className="input-console" onSubmit={handleSubmit}>
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Enter prompt..."
        disabled={disabled}
        className="input-console__field"
        aria-label="Prompt input"
      />
      <button type="submit" disabled={disabled || !input.trim()} className="input-console__submit">
        Send
      </button>
    </form>
  );
};
