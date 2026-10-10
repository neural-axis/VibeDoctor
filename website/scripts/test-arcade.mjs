// Exercise the actual Astro game script with a deterministic clock and a minimal DOM.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
class Element {
  hidden = false; textContent = ''; style = {setProperty() {}}; children = []; events = {};
  classList = {add() {}, remove() {}};
  clientWidth = 390; clientHeight = 500;
  append(el) {this.children.push(el);el.parent=this;}
  remove() {this.parent.children=this.parent.children.filter(el=>el!==this);}
  replaceChildren() {this.children=[];}
  setAttribute(name,value) {this[name]=value;}
  addEventListener(name,fn) {(this.events[name]??=[]).push(fn);}
  async fire(name) {for (const fn of this.events[name]??[]) await fn();}
  focus() {document.activeElement=this;}
  showModal() {this.open=true;}
  close() {this.open=false;this.fire('close');}
}
const fields={};for(const key of ['open','close','arena','bugs','score','streak','time','results','hud','warning','status','final','record','best','rank','replay','sound','share']) fields[key]=new Element();
const dialog=new Element(), root=new Element();
root.querySelector=selector=>selector==='dialog'?dialog:fields[selector.slice(6,-1)];
const document=new Element();document.querySelector=()=>root;document.createElement=()=>new Element();document.hidden=false;
let now=0, next=0, frames=new Map(), storage=new Map(), clipboard='';
const context=vm.createContext({document,performance:{now:()=>now},window:{matchMedia:()=>({matches:false}),setTimeout:()=>{},location:{href:'https://vibedoctor.in/'}},navigator:{clipboard:{writeText:async text=>{clipboard=text;}}},localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id),URL,DOMException,console});
const source=readFileSync(new URL('../src/components/ShipItArcade.astro',import.meta.url),'utf8').split('<script>')[1].split('</script>')[0];
vm.runInContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022}),context);
const advance=ms=>{now+=ms;const callbacks=[...frames.values()];frames.clear();for(const fn of callbacks) fn(now);};
await fields.open.fire('click');assert(dialog.open);assert.equal(fields.bugs.children.length,6);
const first=fields.bugs.children[0];const gain=first.className.includes('gold')?3:1;
await first.fire('click');assert.equal(fields.score.textContent,String(gain));
await first.fire('click');assert.equal(fields.score.textContent,String(gain),'removed bugs cannot score twice');
advance(5000);document.hidden=true;await document.fire('visibilitychange');advance(30000);assert(fields.results.hidden,'hidden tab must not end the game');
document.hidden=false;await document.fire('visibilitychange');advance(9000);assert(fields.results.hidden);advance(1001);assert(!fields.results.hidden);assert.equal(fields.bugs.children.length,0);
assert.equal(storage.get('vibedoctor-ship-arcade-best'),String(gain));
await fields.share.fire('click');assert.match(clipboard,/vibedoctor.in/);assert.match(fields.status.textContent,/copied/);
await fields.replay.fire('click');assert.equal(fields.score.textContent,'0');assert.equal(fields.bugs.children.length,6);
await fields.close.fire('click');assert(!dialog.open);assert.equal(frames.size,0);assert.equal(fields.bugs.children.length,0);assert.equal(document.activeElement,fields.open);
await fields.open.fire('click');assert.equal(fields.time.textContent,'15');assert.equal(fields.bugs.children.length,6);
console.log('Arcade: scoring, double-click protection, timer, hidden-tab pause, best score, sharing, replay, cleanup and reopening passed.');
