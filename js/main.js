/**
 * Entry point — wires up the terminal I/O to the game engine.
 */

import { Renderer } from './renderer.js';
import { Engine } from './engine.js';

const outputEl = document.getElementById('output');
const inputEl = document.getElementById('input');
const promptEl = document.getElementById('prompt');

const renderer = new Renderer(outputEl);
const engine = new Engine(renderer);

// handle input
inputEl.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    const value = inputEl.value;
    inputEl.value = '';

    // echo the command
    renderer.print(`> ${value}`, 'dim');

    // process
    await engine.handleCommand(value);

    // update prompt based on state
    if (engine.state === 'playing' && engine.currentRoom) {
      promptEl.textContent = `${engine.currentRoom.name}> `;
    } else {
      promptEl.textContent = '> ';
    }
  }
});

// keep input focused
document.addEventListener('click', () => inputEl.focus());

// command history
let commandHistory = [];
let historyIndex = -1;

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (historyIndex < commandHistory.length - 1) {
      historyIndex++;
      inputEl.value = commandHistory[commandHistory.length - 1 - historyIndex];
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (historyIndex > 0) {
      historyIndex--;
      inputEl.value = commandHistory[commandHistory.length - 1 - historyIndex];
    } else {
      historyIndex = -1;
      inputEl.value = '';
    }
  } else if (e.key === 'Enter' && inputEl.value.trim()) {
    commandHistory.push(inputEl.value.trim());
    historyIndex = -1;
  }
});

// boot
engine.showWelcome();
