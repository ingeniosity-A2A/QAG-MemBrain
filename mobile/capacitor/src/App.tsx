// Placeholder — AVA007 AMOS root component
// Routes through AvaContext → InputOrchestrativeInterface → Meta Harness
import React from 'react';
import { AvaContextProvider } from './AvaContext';
import { InputOrchestrativeInterface } from './InputOrchestrativeInterface';

export function App() {
  return (
    <AvaContextProvider>
      <InputOrchestrativeInterface />
    </AvaContextProvider>
  );
}
