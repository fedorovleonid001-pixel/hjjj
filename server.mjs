import { spawn } from 'node:child_process';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
const index=readFileSync(new URL('./index.html',import.meta.url));
const loadingArt=readFileSync(new URL('./loading-classic.png',import.meta.url));
const save=new URL('./save.json',import.meta.url), temp=new URL('./save.tmp',import.meta.url);
const accounts=existsSync(save)?new Map(Object.entries(JSON.parse(readFileSync(save,'utf8')))):new Map();
const seen=new Map();
const fighters=[
 {name:'Гоку',skill:'Камехамеха',power:32},{name:'Криллин',skill:'Киэндзан',power:28},
 {name:'Пикколо',skill:'Маканкосаппо',power:39},{name:'Гохан',skill:'Масэнко',power:41},
 {name:'Вегета',skill:'Галик Ган',power:43},{name:'Транкс',skill:'Горящая атака',power:46},{name:'Бульма',skill:'Капсульный залп',power:34}
];
const equipment={
 fan:{name:'Улучшенный Баншо Фан',slot:'weapon',icon:'⚗',stat:'Атака ки',value:60,bp:60},
 armor:{name:'Куртка школы Черепахи',slot:'armor',icon:'🥋',stat:'Защита',value:12,bp:24},
 boots:{name:'Сапоги ученика',slot:'boots',icon:'🥾',stat:'Здоровье',value:20,bp:20}
};
const starterLoot={fan:1,armor:1,boots:1};
const heroSkills={earth:'Удар дракона',saiyan:'Вспышка Саяна',majin:'Розовая спираль',frieza:'Луч сверхновой'};
const maxVitality=90;
const serverLabel='S1';
const enemies=['Ямча','Тэн Син Хан','Радиц','Наппа','Фриза','Селл'];
function persist(){writeFileSync(temp,JSON.stringify(Object.fromEntries(accounts)));renameSync(temp,save)}
function assert(ok,message){if(!ok)throw Error(message)}
function run({action,token,name,id,race,gender}){
 let p=accounts.get(token);
 const avatar=()=>{
  assert(['earth','saiyan','majin','frieza'].includes(race)&&['male','female'].includes(gender),'Выбери расу и пол');
  return {race,gender};
 };
 if(action==='join'){
   assert(typeof name==='string'&&name.trim().length>0&&name.trim().length<=24,'Введи имя от 1 до 24 символов');
   token=randomUUID();p={name:name.trim(),coins:100,wins:0,owned:[0,1],team:[0,1],battle:null};p.avatar=avatar();accounts.set(token,p);
 }
 assert(p,'Войди в игру');
 if(p.battle&&!p.battle.allies)p.battle=null;
 p.xp??={};
 const level=id=>1+Math.floor((p.xp[id]??0)/100);
 let effect, payout;
 const worn=()=>Object.values(p.equipped??{}).map(id=>equipment[id]);
 const b=p.battle;
 switch(action){
 case 'join':case 'state':break;
 case 'summon':{
  const locked=fighters.map((_,i)=>i).filter(i=>!p.owned.includes(i)&&fighters[i].name!=='Бульма');
  assert(p.coins>=100&&locked.length,'Призыв сейчас недоступен');p.coins-=100;p.owned.push(locked[Math.floor(Math.random()*locked.length)]);break;
 }
 case 'team':
  assert(!b||b.done,'Заверши бой');assert(p.owned.includes(id),'Боец закрыт');
  if(p.team.includes(id)){assert(p.team.length>1,'Оставь хотя бы одного бойца');p.team=p.team.filter(i=>i!==id)}
  else{assert(p.team.length<3,'В отряде уже три бойца');p.team.push(id)}
  break;
 case 'avatar':assert(!p.avatar,'Герой уже создан');p.avatar=avatar();break;
 case 'accept':assert(p.avatar&&!p.quest&&(!b||b.done),'Квест недоступен');p.quest='accepted';break;
 case 'turnin':{
  assert(p.quest==='ready','Заверши тренировку');
  const first=!p.turtleReturned, bulma=p.battle?.chapter==='bulma'&&!p.bulmaJoined;
  payout={silver:first||bulma?100:80,xp:first?300:bulma?280:250,bp:32,items:first?Object.keys(starterLoot):[]};
  p.quest=null;p.silver=(p.silver??0)+payout.silver;p.heroXp=(p.heroXp??0)+payout.xp;p.trainingPower=(p.trainingPower??0)+payout.bp;
  if(bulma){p.bulmaJoined=true;const i=fighters.findIndex(f=>f.name==='Бульма');if(!p.owned.includes(i))p.owned.push(i);if(p.team.length<3&&!p.team.includes(i))p.team.push(i);payout.recruit='Бульма'}
  if(first){p.turtleReturned=true;p.bag={...starterLoot}}
  break;
 }
 case 'equip':{
  assert(!b||b.done,'Заверши бой, чтобы сменить экипировку');
  assert(Object.hasOwn(equipment,id)&&p.bag?.[id]>0,'Предмет недоступен');
  p.equipped??={};p.equipped[equipment[id].slot]=id;break;
 }
 case 'unequip':
  assert(!b||b.done,'Заверши бой, чтобы сменить экипировку');
  assert(p.equipped&&Object.hasOwn(p.equipped,id),'Слот пуст');
  delete p.equipped[id];break;
 case 'start':{
  assert(p.quest==='accepted','Прими квест у Роши');
  assert(!b||b.done,'Бой уже начался');
  assert(!b?.reward||b.reward.pick!==null,'Сначала открой карту');
  const vitality=p.vitality??maxVitality;
  assert(vitality>0,'Недостаточно выносливости');
  p.vitality=vitality-1;
  const chapter=p.turtleReturned&&!p.bulmaJoined?'bulma':'training';
  const rank=Math.min(p.wins,enemies.length-1);
  const makeUnit=(name,max)=>({name,max,hp:max});
  p.battle={
   allies:[
    {...makeUnit(p.name,60+Math.floor((p.heroXp??0)/250)*5+(p.equipped?.boots?equipment.boots.value:0)),hero:true,skill:heroSkills[p.avatar.race]},
    ...p.team.map(id=>({...makeUnit(fighters[id].name,55+(level(id)-1)*5+(p.equipped?.boots?equipment.boots.value:0)),id}))
   ],
   chapter,
   foes:chapter==='bulma'?[makeUnit('Обезьяна',26),makeUnit('Бульма',46)]:Array.from({length:Math.min(p.team.length,enemies.length-rank)},(_,i)=>makeUnit(enemies[rank+i],32+rank*4)),
   rank,turn:0,actor:0,ki:1,log:'Выбери цель и действие.',done:false
  };
  break;
 }
 case 'block':case 'hit':case 'charge':case 'skill':{
  assert(b&&!b.done,'Начни новый бой');
  const ally=b.allies[b.actor],f=ally.hero?{name:ally.name,skill:ally.skill,power:32}:fighters[ally.id],foe=b.foes[id];
  if(action==='hit'||action==='skill')assert(foe?.hp>0,'Выбери живого противника');
  if(action==='skill')assert(b.ki>=2,'Не хватает ки');
  if(action==='skill'||action==='hit')effect={id:ally.id,name:f.name,skill:f.skill,kind:action,actor:b.actor,target:id,avatar:ally.hero?p.avatar:null};
  const bonus=(ally.hero?Math.floor((p.heroXp??0)/250):level(ally.id)-1)*2+(p.equipped?.weapon?Math.floor(equipment.fan.value/10):0);
  const damage=action==='skill'?f.power+bonus:action==='hit'?Math.floor(f.power/2)+bonus:0;
  b.ki=Math.min(3,b.ki+(action==='skill'?-2:action==='charge'?2:1));
  if(damage)foe.hp=Math.max(0,foe.hp-damage);
  const enemy=b.foes.find(unit=>unit.hp>0);
  if(!enemy){
 b.done=true;p.wins++;
 const cards=[{xp:30,coins:80},{xp:40,coins:60},{xp:60,coins:40}];
 for(let i=2;i>0;i--){const j=Math.floor(Math.random()*(i+1));[cards[i],cards[j]]=[cards[j],cards[i]]}
 b.reward={cards,pick:null,stars:b.allies.every(u=>u.hp>0)?5:3,team:[...p.team]};
 b.log='Квест завершён!';break;
}
  const baseDamage=Math.max(1,(action==='charge'?4:7)+b.rank-(p.equipped?.armor?Math.floor(equipment.armor.value/4):0));
  const retaliation=action==='block'?Math.ceil(baseDamage/2):baseDamage;
  ally.hp=Math.max(0,ally.hp-retaliation);
  b.turn++;
  const order=b.allies.map((_,i)=>(b.actor+1+i)%b.allies.length);
  const next=order.find(i=>b.allies[i].hp>0);
  b.done=next===undefined||b.turn>=20;
  if(next!==undefined)b.actor=next;
  b.log=b.done?(next===undefined?'Поражение.':'Лимит раундов исчерпан.'):`${ally.name}: ${damage?'урон '+damage:'накапливает ки'}. ${enemy.name} ${enemy.name==='Бульма'?'делает капсульный залп и ':''}наносит ${retaliation} в ответ.${action==='block'?' БЛОК · '+baseDamage+' → '+retaliation:''}`;
  break;
 }

 case 'reward':{
  const r=b?.reward;
  assert(r&&Number.isInteger(id)&&id>=0&&id<3,'Карта недоступна');
  if(r.pick!==null)break;
  if(p.quest==='accepted')p.quest='ready';
  r.pick=id;const card=r.cards[id];p.coins+=card.coins;
  for(const member of r.team)p.xp[member]=(p.xp[member]??0)+card.xp;
  break;
 }

 default:throw Error('Неизвестное действие');
 }
 if(action!=='state')persist();
 const now=Date.now();seen.set(token,now);
 for(const [key,time] of seen){if(now-time>20000)seen.delete(key)}
 const {battle:stored,...player}=p; const battle=stored?.reward?{...stored,reward:{stars:stored.reward.stars,pick:stored.reward.pick,cards:stored.reward.pick===null?null:stored.reward.cards}}:stored;
 const power=100+(p.trainingPower??0)+p.team.reduce((sum,id)=>sum+fighters[id].power*3+(level(id)-1)*6,0)+worn().reduce((sum,item)=>sum+item.bp,0);
 const combatStats={attack:115+(p.equipped?.weapon?equipment.fan.value:0),defense:56+(p.equipped?.armor?equipment.armor.value:0),hp:55+(p.equipped?.boots?equipment.boots.value:0)};
 const rankLabel=power>=500?'A':power>=370?'A−':power>=300?'B':'C';
 return {player:{...player,vitality:p.vitality??maxVitality,maxVitality,serverLabel,heroLevel:1+Math.floor((p.heroXp??0)/250),power,rankLabel,combatStats},battle,fighters,equipment,payout,effect,online:[...seen.keys()].map(key=>accounts.get(key).name),...(action==='join'?{token}:{})};
}
const server=http.createServer(async(req,res)=>{
 const artPath={'/village-clean.png':'village-clean.png','/character-select.png':'character-select.png','/capsule-plaza.png':'capsule-plaza.png','/green-valley.png':'green-valley.png','/kame-beach.png':'kame-beach.png','/heroes.png':'heroes.png','/world.png':'world.png','/valley.png':'valley.png','/bulma.png':'bulma.png','/roshi.png':'roshi.png','/inventory-load.png':'inventory-load.png'}[req.url];
 if(req.method==='GET'&&typeof artPath==='string'){
  res.writeHead(200,{'Content-Type':'image/png'});res.end(readFileSync(new URL(artPath,import.meta.url)));return;
 }

 if(req.method==='GET'&&req.url==='/loading-classic.png'){res.writeHead(200,{'Content-Type':'image/png'});res.end(loadingArt);return}
 if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(index);return}
 if(req.method!=='POST'||req.url!=='/api'){res.writeHead(404);res.end();return}
 let result,status=200;
 try{let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw Error('Запрос слишком большой')}result=run(JSON.parse(body))}
 catch(error){status=400;result={error:error.message}}
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(result));
});
server.listen(Number(process.env.DB_GAME_PORT||8787),process.env.DB_GAME_HOST||'127.0.0.1',()=>{
 const url='http://127.0.0.1:'+server.address().port;
 console.log(url);
 if(process.argv.includes('--open')){
  const browser=spawn('explorer.exe',[url],{stdio:'ignore'});
  browser.on('error',()=>console.log('Open this URL in your browser: '+url));
 }
});










