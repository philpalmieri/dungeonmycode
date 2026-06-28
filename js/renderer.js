/**
 * Terminal renderer — handles all output to the virtual terminal.
 */

export class Renderer {
  constructor(outputEl) {
    this.output = outputEl;
  }

  print(text = '', colorClass = null) {
    const line = document.createElement('div');
    if (colorClass) line.className = colorClass;
    line.textContent = text;
    this.output.appendChild(line);
    this.scrollToBottom();
  }

  printArt(text) {
    const pre = document.createElement('pre');
    pre.className = 'bright';
    pre.textContent = text;
    pre.style.lineHeight = '1.1';
    pre.style.fontSize = '14px';
    this.output.appendChild(pre);
    this.scrollToBottom();
  }

  printHTML(html, colorClass = null) {
    const line = document.createElement('div');
    if (colorClass) line.className = colorClass;
    line.innerHTML = html;
    this.output.appendChild(line);
    this.scrollToBottom();
  }

  clear() {
    this.output.innerHTML = '';
  }

  scrollToBottom() {
    this.output.scrollTop = this.output.scrollHeight;
  }
}
