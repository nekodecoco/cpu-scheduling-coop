/* ============================================================================
   Node test harness for the scheduling core.

   Deliberately does NOT contain its own copy of the solvers — it slices §2 out
   of index.html and evaluates that. A duplicated core could pass here while the
   shipped app is broken, which is exactly the failure this suite exists to catch.

   Run:  node test/run-tests.js
   ========================================================================= */

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const START = '§2  CORRECTNESS CORE';
const END   = '§3  REALTIME ADAPTER';
const aMark = html.indexOf(START), bMark = html.indexOf(END);
if (aMark < 0 || bMark < 0) {
  console.error('Could not locate the §2 core section in index.html — did the section headers change?');
  process.exit(1);
}
// Both markers sit inside /* … */ banners, so back up to the opening delimiter
// of each; slicing at the marker itself would orphan the comment syntax.
const a = html.lastIndexOf('/*', aMark);
const b = html.lastIndexOf('/*', bMark);
const coreSrc = html.slice(a, b);

const EXPORTS = ['solve','hasAmbiguity','generateProblem','gradeSubmission','scoreRound',
                 'seedFor','mulberry32','mergeSlots','boardWidth','rngDistinct','rngShuffle'];
const C = new Function(coreSrc + '\nreturn {' + EXPORTS.join(',') + '};')();

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '\n        ' + extra : '')); }
};
const P = (pid, at, bt, pr) => ({ pid, at, bt, pr });
const g = (sol) => sol.segments.map(s => `${s.pid}(${s.start}-${s.end})`).join(' ');

console.log('\n=== TEXTBOOK VERIFICATION (Silberschatz, Operating System Concepts Ch.6) ===\n');

{
  const s = C.solve('fcfs', { procs:[P('P1',0,24,1),P('P2',0,3,2),P('P3',0,3,3)], quantum:null });
  ok('FCFS gantt', g(s) === 'P1(0-24) P2(24-27) P3(27-30)', g(s));
  ok('FCFS avgWT = 17', s.avgWT === 17, 'got ' + s.avgWT);
  ok('FCFS avgTAT = 27', s.avgTAT === 27, 'got ' + s.avgTAT);
}
{
  const s = C.solve('sjf', { procs:[P('P1',0,6,1),P('P2',0,8,2),P('P3',0,7,3),P('P4',0,3,4)], quantum:null });
  ok('SJF gantt P4,P1,P3,P2', g(s) === 'P4(0-3) P1(3-9) P3(9-16) P2(16-24)', g(s));
  ok('SJF avgWT = 7', s.avgWT === 7, 'got ' + s.avgWT);
}
{
  const s = C.solve('srtf', { procs:[P('P1',0,8,1),P('P2',1,4,2),P('P3',2,9,3),P('P4',3,5,4)], quantum:null });
  ok('SRTF gantt', g(s) === 'P1(0-1) P2(1-5) P4(5-10) P1(10-17) P3(17-26)', g(s));
  ok('SRTF avgWT = 6.5', s.avgWT === 6.5, 'got ' + s.avgWT);
}
{
  const s = C.solve('priorityNP', { procs:[P('P1',0,10,3),P('P2',0,1,1),P('P3',0,2,4),P('P4',0,1,5),P('P5',0,5,2)], quantum:null });
  ok('Priority NP gantt', g(s) === 'P2(0-1) P5(1-6) P1(6-16) P3(16-18) P4(18-19)', g(s));
  ok('Priority NP avgWT = 8.2', s.avgWT === 8.2, 'got ' + s.avgWT);
}
{
  const s = C.solve('rr', { procs:[P('P1',0,24,1),P('P2',0,3,2),P('P3',0,3,3)], quantum:4 });
  ok('RR q=4 gantt', g(s) === 'P1(0-4) P2(4-7) P3(7-10) P1(10-30)', g(s));
}
{
  // Preemptive priority, hand-computed:
  // P1 runs 0-2, preempted by P2 (pr2), preempted by P3 (pr1) at t=5,
  // P2 resumes 8-10, then P4 (pr3) 10-14, then P1 finishes 14-20.
  const s = C.solve('priorityP', { procs:[P('P1',0,8,4),P('P2',2,5,2),P('P3',5,3,1),P('P4',9,4,3)], quantum:null });
  ok('Priority P gantt', g(s) === 'P1(0-2) P2(2-5) P3(5-8) P2(8-10) P4(10-14) P1(14-20)', g(s));
}
{
  const s = C.solve('fcfs', { procs:[P('P1',0,3,1),P('P2',7,2,2)], quantum:null });
  ok('idle gap emitted as IDLE segment', g(s) === 'P1(0-3) IDLE(3-7) P2(7-9)', g(s));
  ok('idle does not distort avgWT', s.avgWT === 0, 'got ' + s.avgWT);
}

console.log('\n=== GENERATOR INVARIANTS (5000 seeds x 6 algorithms) ===\n');

const ALGOS = ['fcfs','priorityNP','sjf','priorityP','srtf','rr'];
for (const algo of ALGOS) {
  let ambiguous = 0, noZero = 0, burstMismatch = 0, minLen = 1e9, maxLen = 0;
  for (let seed = 1; seed <= 5000; seed++) {
    const prob = C.generateProblem(algo, seed);
    if (C.hasAmbiguity(algo, prob)) ambiguous++;
    if (!prob.procs.some(p => p.at === 0)) noZero++;
    const sol = C.solve(algo, prob);
    minLen = Math.min(minLen, sol.slots.length);
    maxLen = Math.max(maxLen, sol.slots.length);
    for (const p of prob.procs) {
      if (sol.slots.filter(s => s === p.pid).length !== p.bt) burstMismatch++;
    }
    if (C.boardWidth(prob) < sol.slots.length) burstMismatch++;   // board must never truncate
  }
  ok(`${algo.padEnd(11)} 5000/5000 unambiguous`, ambiguous === 0, ambiguous + ' ambiguous');
  ok(`${algo.padEnd(11)} always an arrival at t=0`, noZero === 0, noZero + ' without');
  ok(`${algo.padEnd(11)} bursts conserved & board wide enough`, burstMismatch === 0, burstMismatch + ' bad');
  ok(`${algo.padEnd(11)} board length ${minLen}-${maxLen} within [12,34]`, minLen >= 12 && maxLen <= 34);
}

console.log('\n=== DETERMINISM ===\n');
{
  const a = JSON.stringify(C.generateProblem('sjf', C.seedFor('CPU-42', 2)));
  let stable = true;
  for (let i = 0; i < 100; i++) {
    if (JSON.stringify(C.generateProblem('sjf', C.seedFor('CPU-42', 2))) !== a) stable = false;
  }
  ok('same room+round identical across 100 regenerations', stable);
  ok('room code is case-insensitive', JSON.stringify(C.generateProblem('sjf', C.seedFor('cpu-42', 2))) === a);
  ok('different room differs', JSON.stringify(C.generateProblem('sjf', C.seedFor('CPU-77', 2))) !== a);
  ok('different round differs', JSON.stringify(C.generateProblem('sjf', C.seedFor('CPU-42', 3))) !== a);
}

console.log('\n=== GRADING & SCORING ===\n');
{
  const prob = C.generateProblem('fcfs', C.seedFor('CPU-11', 0));
  const sol = C.solve('fcfs', prob);
  const correct = sol.slots.map(s => s || null);

  let r = C.gradeSubmission('fcfs', prob, correct, sol.avgTAT, sol.avgWT);
  ok('correct board + metrics', r.ganttOK && r.metricsOK);

  const wrong = correct.slice(); wrong[0] = wrong[0] === 'P1' ? 'P2' : 'P1';
  ok('one wrong cell fails gantt only',
     (() => { const x = C.gradeSubmission('fcfs', prob, wrong, sol.avgTAT, sol.avgWT); return !x.ganttOK && x.metricsOK; })());

  ok('wrong TAT fails metrics',
     !C.gradeSubmission('fcfs', prob, correct, sol.avgTAT + 1, sol.avgWT).metricsOK);
  ok('2dp rounding slack accepted',
     C.gradeSubmission('fcfs', prob, correct, sol.avgTAT + 0.004, sol.avgWT - 0.004).metricsOK);
  ok('trailing block rejected',
     !C.gradeSubmission('fcfs', prob, correct.concat(['P1']), sol.avgTAT, sol.avgWT).ganttOK);
  ok('trailing empties accepted (board is wider than the answer)',
     C.gradeSubmission('fcfs', prob, correct.concat([null,null,null]), sol.avgTAT, sol.avgWT).ganttOK);
  ok('missing final block rejected',
     !C.gradeSubmission('fcfs', prob, correct.slice(0,-1), sol.avgTAT, sol.avgWT).ganttOK);

  ok('perfect + 45s left = 245', C.scoreRound({ganttOK:true,metricsOK:true,secondsLeft:45,wrongAttempts:0}) === 245);
  ok('perfect after 2 wrong = 205', C.scoreRound({ganttOK:true,metricsOK:true,secondsLeft:45,wrongAttempts:2}) === 205);
  ok('gantt only, no speed bonus = 100', C.scoreRound({ganttOK:true,metricsOK:false,secondsLeft:45,wrongAttempts:0}) === 100);
  ok('never negative', C.scoreRound({ganttOK:false,metricsOK:false,secondsLeft:0,wrongAttempts:3}) === 0);
}

console.log(`\n${'='.repeat(58)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(58)}\n`);
process.exit(fail ? 1 : 0);
