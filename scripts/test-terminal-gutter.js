/**
 * 终端时间戳/行号栏自检：用真实 xterm 缓冲区（不渲染）验证编号、裁剪、清屏、备用屏幕
 * 用法：node scripts/test-terminal-gutter.js
 */
// 最小 DOM 桩：只供行号栏构造时创建/插入元素
const el = () => ({ style: {}, dataset: {}, setAttribute() {}, remove() {}, innerHTML: '' });
global.document = { createElement: el };
global.window = global;
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
const { Terminal } = require('@xterm/xterm');
const { TerminalGutter } = require(require('path').join(__dirname, '..', 'src', 'renderer', 'js', 'terminalGutter.js'));
const H = require(require('path').join(__dirname, '..', 'src', 'renderer', 'js', 'terminalHighlighter.js'));

const term = new Terminal({ cols: 40, rows: 10, scrollback: 50, allowProposedApi: true });
const g = new TerminalGutter(term, { container: { insertBefore() {} }, before: null });
const write = (s) => new Promise(r => term.write(s, r));
const nums = () => g.rowsModel().filter(Boolean).map(r => (r.cur ? '*' : '') + r.num);
const checks = {};
(async () => {
  await write('line1\r\nline2\r\n[root@h ~]# ');
  checks['基础行号与光标行'] = [nums().join(','), '1,2,*3'];
  checks['时间戳已记录'] = [String(g.rowsModel().filter(Boolean).every(r => r.time > 0)), 'true'];
  await write('\r\n' + 'x'.repeat(45) + '\r\nafter');
  checks['续行不显示行号'] = [nums().join(','), '1,2,3,4,*6'];
  let s = ''; for (let i = 0; i < 200; i++) s += '\r\nL' + i;
  await write(s);
  checks['回滚区裁剪后继续编号'] = [nums().slice(-2).join(','), '205,*206'];
  checks['buffer 已裁剪到上限'] = [String(term.buffer.active.length), '60'];
  term.clear(); g.handleClear();
  await write('\r\nnext');
  checks['本地清屏后接续'] = [nums().join(','), '206,*207'];
  await write('\x1b[?1049h\x1b[Hvim');
  checks['备用屏幕留空'] = [String(nums().length), '0'];
  await write('\x1b[?1049l\r\nback');
  checks['退出备用屏幕后恢复'] = [nums().slice(-2).join(','), '207,*208'];
  // 远端 clear 命令：CSI H CSI 2J CSI 3J
  await write('\x1b[H\x1b[2J\x1b[3J[root@h ~]# ');
  checks['远端 clear 后不倒退'] = [String(+nums().slice(-1)[0].replace('*', '') >= 208), 'true'];
  await write('\r\nz');
  const last = nums().slice(-1)[0];
  // 高亮后文本不变
  const hl = new H.Highlighter(H.compileRules(H.defaultConfig()));
  const raw = 'tmpfs 3.9G 396M 11% /run';
  await write('\r\n' + hl.process(raw));
  const b = term.buffer.active;
  checks['高亮写入后文本一致'] = [b.getLine(b.baseY + b.cursorY).translateToString(true), raw];
  let ok = true;
  for (const [k, [got, want]] of Object.entries(checks)) {
    const pass = got === want; ok = ok && pass;
    console.log(`${pass ? 'OK  ' : 'FAIL'} ${k}  got=${got}${pass ? '' : ' want=' + want}`);
  }
  console.log('远端 clear 后下一行:', last);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
