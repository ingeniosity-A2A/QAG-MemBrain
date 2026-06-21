// Placeholder — AVA007 AMOS web shell entry point
// Full implementation pending; see docs/AMOS_v2.1_ARCHITECTURE.md
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing');
const root = createRoot(container);
root.render(<App />);
