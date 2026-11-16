import './style.css';
import { boot } from './app';

const root = document.getElementById('app');
if (!root) throw new Error('缺少 #app 挂载点');

// 未捕获异常直接画到页面上：浏览器控制台在自动化场景下不一定能拿到，
// 而「主循环悄悄停掉」是最难排查的一类问题。
const errBox = document.createElement('pre');
errBox.style.cssText =
  'position:fixed;left:0;top:0;z-index:99999;margin:0;padding:8px;max-height:45vh;overflow:auto;' +
  'background:rgba(0,0,0,.82);color:#ff7b5a;font:12px/1.45 Consolas,monospace;white-space:pre-wrap;display:none';
document.body.appendChild(errBox);

// 主循环自己的错误盒子（由 app 写入），与全局未捕获错误分开，便于定位
const loopBox = errBox.cloneNode() as HTMLPreElement;
loopBox.id = 'loop-error';
document.body.appendChild(loopBox);

function report(msg: string): void {
  errBox.style.display = 'block';
  errBox.textContent += `${msg}\n`;
}

window.addEventListener('error', (ev) => {
  report(`ERROR: ${ev.message}\n  at ${ev.filename}:${ev.lineno}:${ev.colno}`);
});
window.addEventListener('unhandledrejection', (ev) => {
  report(`UNHANDLED: ${String((ev as PromiseRejectionEvent).reason)}`);
});

boot(root);
