import {
  FullscreenControl, GeoJSONSource, Map as MapLibreMap, NavigationControl,
  Popup, type MapLayerMouseEvent,
} from "maplibre-gl";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";

interface Stop {
  slug:string; title:string; start_date:string; classification:string|null; venue_id:string;
  venue_name:string; area_name:string|null; country_code:string|null; latitude:number; longitude:number;
  coordinate_precision:"venue"|"area";
}
interface Payload { summary:{events:number;venues:number;countries:number}; stops:Stop[] }
interface YouTubePlayer { playVideo:()=>void; pauseVideo:()=>void }
interface YouTubeApi { Player:new(element:HTMLIFrameElement,options:{events:{onReady:()=>void;onAutoplayBlocked:()=>void;onError:()=>void}})=>YouTubePlayer }

const DAY=86_400_000;
const root=document.querySelector<HTMLElement>("[data-live-journey]");
const empty=<T extends Point|LineString>():FeatureCollection<T>=>({type:"FeatureCollection",features:[]});
const time=(stop:Stop)=>Date.parse(`${stop.start_date}T00:00:00Z`);

function distanceKm(from:Stop,to:Stop):number{
  const radians=Math.PI/180,latitudeDelta=(to.latitude-from.latitude)*radians,longitudeDelta=(to.longitude-from.longitude)*radians;
  const a=Math.sin(latitudeDelta/2)**2+Math.cos(from.latitude*radians)*Math.cos(to.latitude*radians)*Math.sin(longitudeDelta/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function journeyZoom(distance:number,currentZoom?:number):number{
  const tiers=[{zoom:13,min:0,max:10},{zoom:9.6,min:6,max:110},{zoom:6.2,min:80,max:800},{zoom:4.8,min:600,max:Infinity}];
  const target=distance<=8?tiers[0]:distance<=100?tiers[1]:distance<=700?tiers[2]:tiers[3];
  if(currentZoom===undefined)return target.zoom;
  const current=tiers.reduce((best,tier)=>Math.abs(tier.zoom-currentZoom)<Math.abs(best.zoom-currentZoom)?tier:best);
  return Math.abs(current.zoom-currentZoom)<=.8&&distance>=current.min&&distance<=current.max?current.zoom:target.zoom;
}

function arc(from:Stop,to:Stop,routeIndex:number,steps=24):number[][]{
  const r=Math.PI/180,d=180/Math.PI,p1=from.latitude*r,l1=from.longitude*r,p2=to.latitude*r,l2=to.longitude*r;
  const delta=2*Math.asin(Math.sqrt(Math.sin((p2-p1)/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin((l2-l1)/2)**2));
  if(delta<.00001)return[[from.longitude,from.latitude],[to.longitude,to.latitude]];
  const base=Array.from({length:steps+1},(_,index)=>{
    const f=index/steps,a=Math.sin((1-f)*delta)/Math.sin(delta),b=Math.sin(f*delta)/Math.sin(delta);
    const x=a*Math.cos(p1)*Math.cos(l1)+b*Math.cos(p2)*Math.cos(l2),y=a*Math.cos(p1)*Math.sin(l1)+b*Math.cos(p2)*Math.sin(l2),z=a*Math.sin(p1)+b*Math.sin(p2);
    return[Math.atan2(y,x)*d,Math.atan2(z,Math.sqrt(x*x+y*y))*d];
  });
  let deltaLongitude=to.longitude-from.longitude;
  if(deltaLongitude>180)deltaLongitude-=360;if(deltaLongitude< -180)deltaLongitude+=360;
  const deltaLatitude=to.latitude-from.latitude,length=Math.hypot(deltaLongitude,deltaLatitude)||1;
  const bend=Math.min(2.5,Math.max(.08,length*.08))*(routeIndex%2===0?1:-1);
  const perpendicularLongitude=-deltaLatitude/length,perpendicularLatitude=deltaLongitude/length;
  return base.map((point,index)=>{const lift=Math.sin(Math.PI*index/steps)*bend;return[point[0]+perpendicularLongitude*lift,point[1]+perpendicularLatitude*lift];});
}

function partialPath(coordinates:number[][],progress:number):number[][]{
  if(progress>=1)return coordinates;
  const position=Math.max(0,progress)*(coordinates.length-1),segment=Math.min(coordinates.length-2,Math.floor(position)),fraction=position-segment;
  const result=coordinates.slice(0,segment+1),from=coordinates[segment],to=coordinates[segment+1];
  result.push([from[0]+(to[0]-from[0])*fraction,from[1]+(to[1]-from[1])*fraction]);
  return result;
}

function pathFrom(coordinates:number[][],progress:number):number[][]{
  if(progress<=0)return coordinates;
  if(progress>=1)return[coordinates.at(-1)!,coordinates.at(-1)!];
  const position=progress*(coordinates.length-1),segment=Math.floor(position),fraction=position-segment,from=coordinates[segment],to=coordinates[segment+1];
  return[[from[0]+(to[0]-from[0])*fraction,from[1]+(to[1]-from[1])*fraction],...coordinates.slice(segment+1)];
}

function routes(stops:Stop[],end:number,progress=1,tailProgress=0):FeatureCollection<LineString>{
  const features:Array<Feature<LineString>>=[];
  for(let index=1;index<=end;index+=1){
    const from=stops[index-1],to=stops[index];
    if(Math.abs(from.latitude-to.latitude)<.00001&&Math.abs(from.longitude-to.longitude)<.00001)continue;
    const coordinates=arc(from,to,index,48);
    const visible=index===end?pathFrom(partialPath(coordinates,progress),tailProgress):coordinates;
    if(index===end&&tailProgress>0)features.push({type:"Feature",properties:{index,day:Math.floor(time(to)/DAY),settled:1},geometry:{type:"LineString",coordinates}});
    features.push({type:"Feature",properties:{index,day:Math.floor(time(to)/DAY),settled:0},geometry:{type:"LineString",coordinates:visible}});
  }
  return{type:"FeatureCollection",features};
}

function points(stops:Stop[],end:number):FeatureCollection<Point>{
  const latest=new Map<string,Stop>();
  stops.slice(0,end+1).forEach(stop=>latest.set(stop.venue_id,stop));
  return{type:"FeatureCollection",features:[...latest.values()].map(stop=>({type:"Feature",properties:{venue:stop.venue_name,area:stop.area_name??"",date:stop.start_date,precision:stop.coordinate_precision},geometry:{type:"Point",coordinates:[stop.longitude,stop.latitude]}}))};
}

function active(coordinates:number[]):FeatureCollection<Point>{
  return{type:"FeatureCollection",features:[{type:"Feature",properties:{},geometry:{type:"Point",coordinates}}]};
}

function addLayers(map:MapLibreMap):void{
  map.addSource("journey-route",{type:"geojson",data:empty<LineString>()});
  map.addSource("journey-points",{type:"geojson",data:empty<Point>()});
  map.addSource("journey-active",{type:"geojson",data:empty<Point>()});
  map.addLayer({id:"journey-route-glow",type:"line",source:"journey-route",paint:{"line-color":"#ff7a2f","line-width":["interpolate",["linear"],["zoom"],1,4,8,12],"line-opacity":.18,"line-blur":6}});
  map.addLayer({id:"journey-route-main",type:"line",source:"journey-route",paint:{"line-color":"#ff7a2f","line-width":2,"line-opacity":.8}});
  map.addLayer({id:"journey-area",type:"circle",source:"journey-points",filter:["==",["get","precision"],"area"],paint:{"circle-radius":["interpolate",["linear"],["zoom"],1,2.5,8,6],"circle-color":"rgba(0,0,0,0)","circle-stroke-color":"#8298ab","circle-stroke-width":1.8}});
  map.addLayer({id:"journey-venue",type:"circle",source:"journey-points",filter:["==",["get","precision"],"venue"],paint:{"circle-radius":["interpolate",["linear"],["zoom"],1,2.5,8,6],"circle-color":"#00dff5","circle-opacity":.86,"circle-stroke-color":"#fff","circle-stroke-width":.7}});
  map.addLayer({id:"journey-active-halo",type:"circle",source:"journey-active",paint:{"circle-radius":["interpolate",["linear"],["zoom"],1,12,8,25],"circle-color":"#00e5ff","circle-opacity":.2,"circle-blur":.55}});
  map.addLayer({id:"journey-active",type:"circle",source:"journey-active",paint:{"circle-radius":["interpolate",["linear"],["zoom"],1,5,8,9],"circle-color":"#ff7a2f","circle-stroke-color":"#fff","circle-stroke-width":1.4}});
  const firstLabel=map.getStyle().layers.find(layer=>layer.type==="symbol")?.id;
  map.addLayer({id:"journey-buildings-3d",type:"fill-extrusion",source:"openmaptiles","source-layer":"building",minzoom:13,paint:{"fill-extrusion-color":"#193646","fill-extrusion-height":["coalesce",["get","render_height"],8],"fill-extrusion-base":["coalesce",["get","render_min_height"],0],"fill-extrusion-opacity":.72}},firstLabel);
}

function agePaint(map:MapLibreMap,currentIndex:number,currentDay:number,duration=0):void{
  if(!map.getLayer("journey-route-main"))return;
  map.setPaintProperty("journey-route-main","line-opacity-transition",{duration,delay:0});
  map.setPaintProperty("journey-route-main","line-width-transition",{duration,delay:0});
  map.setPaintProperty("journey-route-glow","line-opacity-transition",{duration,delay:0});
  const stepAge=["-",currentIndex,["get","index"]] as const;
  const timeAge=["-",currentDay,["get","day"]] as const;
  const stepOpacity=["interpolate",["linear"],stepAge,0,.98,1,.32,3,.18,8,.1,20,.05,60,.018] as const;
  const timeOpacity=["interpolate",["linear"],timeAge,0,.96,30,.84,90,.55,180,.25,365,.08,730,.015] as const;
  map.setPaintProperty("journey-route-main","line-opacity",["case",["==",["get","settled"],1],.32,["min",stepOpacity,timeOpacity]]);
  map.setPaintProperty("journey-route-main","line-width",["case",["==",["get","settled"],1],1.8,["interpolate",["linear"],stepAge,0,3.6,1,1.8,4,1.25,12,.8,40,.5]]);
  map.setPaintProperty("journey-route-glow","line-opacity",["case",["==",["get","settled"],1],0,["interpolate",["linear"],stepAge,0,.34,1,0]]);
}

function popup(properties:Record<string,string>):HTMLElement{
  const node=document.createElement("div"),title=document.createElement("strong"),area=document.createElement("div"),date=document.createElement("small");
  title.textContent=properties.venue;area.textContent=properties.area;date.textContent=properties.date;node.appendChild(title);node.appendChild(area);node.appendChild(date);return node;
}

async function init():Promise<void>{
  if(!root)return;
  const container=root;
  const get=<T>(selector:string):T=>{const node=container.querySelector(selector);if(!node)throw new Error(`Missing ${selector}`);return node as T;};
  const mapElement=get<HTMLElement>("[data-journey-map]"),range=get<HTMLInputElement>("[data-journey-range]"),ticks=get<HTMLElement>("[data-year-ticks]");
  const play=get<HTMLButtonElement>("[data-journey-play]"),speed=get<HTMLSelectElement>("[data-journey-speed]"),filter=get<HTMLSelectElement>("[data-journey-filter]");
  const date=get<HTMLElement>("[data-current-date]"),title=get<HTMLAnchorElement>("[data-current-title]"),place=get<HTMLElement>("[data-current-venue]");
  const precision=get<HTMLElement>("[data-current-precision]"),progress=get<HTMLElement>("[data-journey-progress]"),status=get<HTMLElement>("[data-map-status]");
  const consolePanel=get<HTMLElement>(".journey-console"),phaseJumps=[...container.querySelectorAll<HTMLButtonElement>("[data-phase-jump]")];
  const soundtrack=get<HTMLElement>("[data-soundtrack]"),soundtrackToggle=get<HTMLButtonElement>("[data-soundtrack-toggle]"),youtubeFrame=get<HTMLIFrameElement>("[data-youtube-frame]");
  const payload=await fetch("/api/journey").then(response=>response.json()) as Payload;
  let stops=payload.stops,index=stops.length-1,timer:ReturnType<typeof setTimeout>|undefined,animationFrame:number|undefined,playing=false,runId=0;
  let youtubePlayer:YouTubePlayer|undefined,youtubeReady=false,soundtrackEnabled=true,pendingSoundtrack=false;
  container.querySelectorAll<HTMLElement>("[data-summary-field]").forEach(node=>{const field=node.dataset.summaryField as keyof Payload["summary"];node.textContent=String(payload.summary[field]);});

  const initialCamera=innerWidth<700?{center:[137,36] as [number,number],zoom:3.55}:{center:[137.2,36] as [number,number],zoom:4.25};
  const map=new MapLibreMap({container:mapElement,style:"https://tiles.openfreemap.org/styles/dark",center:initialCamera.center,zoom:initialCamera.zoom,pitch:16,bearing:-8,maxPitch:70,maxTileCacheZoomLevels:innerWidth<700?5:6});
  map.getCanvas().setAttribute("role","application");map.getCanvas().setAttribute("aria-label",container.dataset.mapLabel??"3D globe Journey map");
  map.addControl(new NavigationControl({visualizePitch:true}),"top-right");map.addControl(new FullscreenControl(),"top-right");
  new ResizeObserver(()=>map.resize()).observe(mapElement);
  const syncConsoleHeight=()=>container.style.setProperty("--journey-console-height",`${Math.ceil(consolePanel.getBoundingClientRect().height)}px`);
  new ResizeObserver(syncConsoleHeight).observe(consolePanel);syncConsoleHeight();
  requestAnimationFrame(()=>map.resize());setTimeout(()=>map.resize(),250);

  const playText=get<HTMLElement>("[data-play-text]");
  const pauseSoundtrack=()=>{pendingSoundtrack=false;if(youtubeReady)youtubePlayer?.pauseVideo();};
  const playSoundtrack=()=>{if(!soundtrackEnabled)return;pendingSoundtrack=true;soundtrack.dataset.autoplayBlocked="false";if(youtubeReady){youtubePlayer?.playVideo();pendingSoundtrack=false;}};
  const stopPlay=()=>{runId+=1;playing=false;if(timer!==undefined)clearTimeout(timer);if(animationFrame!==undefined)cancelAnimationFrame(animationFrame);timer=undefined;animationFrame=undefined;map.stop();pauseSoundtrack();play.dataset.playing="false";play.setAttribute("aria-pressed","false");playText.textContent=container.dataset.playLabel??"Play";};
  const sync=(end=index,routeProgress=1,updatePaint=true)=>{const reached=routeProgress<.88?Math.max(0,end-1):end,activeStop=stops[reached];(map.getSource("journey-route") as GeoJSONSource)?.setData(routes(stops,end,routeProgress));(map.getSource("journey-points") as GeoJSONSource)?.setData(points(stops,reached));(map.getSource("journey-active") as GeoJSONSource)?.setData(active([activeStop.longitude,activeStop.latitude]));if(updatePaint)agePaint(map,end,Math.floor(time(stops[end])/DAY));};
  const speedScale=()=>Number(speed.value)/1700;
  const transitionDuration=(from:Stop,to:Stop)=>{if(matchMedia("(prefers-reduced-motion: reduce)").matches)return 0;const natural=Math.min(3000,850+48*Math.sqrt(distanceKm(from,to)));return Math.round(Math.min(4800,Math.max(700,natural*speedScale())));};
  const updateDetails=(next:number)=>{const stop=stops[next];range.value=String(time(stop));progress.textContent=`${next+1} / ${stops.length}`;date.textContent=new Intl.DateTimeFormat(container.dataset.locale??"zh-CN",{year:"numeric",month:"short",day:"numeric",timeZone:"UTC"}).format(new Date(time(stop)));title.textContent=stop.title;title.href=`/events/${encodeURIComponent(stop.slug)}`;place.textContent=[stop.venue_name,stop.area_name].filter(Boolean).join(" · ");precision.textContent=stop.coordinate_precision==="venue"?(container.dataset.exactLabel??"Exact venue"):(container.dataset.approximateLabel??"Approximate area");precision.dataset.precision=stop.coordinate_precision;};
  const render=(next:number,focus=false)=>{index=Math.max(0,Math.min(next,stops.length-1));const stop=stops[index],previous=stops[Math.max(0,index-1)];updateDetails(index);sync();if(focus)map.easeTo({center:[stop.longitude,stop.latitude],zoom:journeyZoom(distanceKm(previous,stop),map.getZoom()),duration:Math.min(1800,transitionDuration(previous,stop))});};
  const animateTo=(next:number,token:number,done:()=>void)=>{
    const from=stops[index],to=stops[next],travelDistance=distanceKm(from,to),duration=transitionDuration(from,to),targetZoom=journeyZoom(travelDistance,map.getZoom());
    let detailsShown=false;updateDetails(index);
    if(duration===0||travelDistance<.01){index=next;updateDetails(next);sync();done();return;}
    const fadeDuration=Math.min(duration,Math.max(320,Math.round(650*speedScale()))),easing=(value:number)=>value<.5?4*value**3:1-(-2*value+2)**3/2;
    const beginTravel=()=>{if(token!==runId)return;agePaint(map,next,Math.floor(time(to)/DAY),fadeDuration);const started=performance.now();map.easeTo({center:[to.longitude,to.latitude],zoom:targetZoom,duration,easing});const tick=(now:number)=>{if(token!==runId)return;const raw=Math.min(1,(now-started)/duration),travelProgress=easing(raw);if(!detailsShown&&travelProgress>=.88){detailsShown=true;updateDetails(next);}sync(next,travelProgress,false);if(raw<1){animationFrame=requestAnimationFrame(tick);return;}animationFrame=undefined;index=next;if(!detailsShown)updateDetails(next);sync(index,1,false);done();};animationFrame=requestAnimationFrame(tick);};
    if(travelDistance<=130&&map.getZoom()<targetZoom-.4){const leadDuration=Math.min(900,Math.max(360,Math.round(520*speedScale()))),center:[number,number]=[(from.longitude+to.longitude)/2,(from.latitude+to.latitude)/2];map.easeTo({center,zoom:targetZoom,duration:leadDuration,easing});timer=setTimeout(beginTravel,Math.round(leadDuration*.78));return;}
    beginTravel();
  };
  const retractLatest=(token:number,done:()=>void)=>{if(index===0){done();return;}const duration=Math.max(240,Math.round(500*speedScale())),started=performance.now(),easing=(value:number)=>1-(1-value)**3;const tick=(now:number)=>{if(token!==runId)return;const raw=Math.min(1,(now-started)/duration);(map.getSource("journey-route") as GeoJSONSource)?.setData(routes(stops,index,1,easing(raw)));if(raw<1){animationFrame=requestAnimationFrame(tick);return;}animationFrame=undefined;done();};animationFrame=requestAnimationFrame(tick);};
  const nearest=(stamp:number)=>{let low=0,high=stops.length-1;while(low<high){const middle=Math.ceil((low+high)/2);if(time(stops[middle])<=stamp)low=middle;else high=middle-1;}return low;};
  const closest=(stamp:number)=>{const before=nearest(stamp),after=Math.min(stops.length-1,before+1);return Math.abs(time(stops[after])-stamp)<Math.abs(time(stops[before])-stamp)?after:before;};
  const timelineStart=()=>Math.min(time(stops[0]),...phaseJumps.map(button=>Date.parse(`${button.dataset.date}T00:00:00Z`)));
  const buildTicks=()=>{ticks.replaceChildren();if(!stops.length)return;const start=timelineStart(),end=time(stops.at(-1)!);phaseJumps.forEach(button=>{const phaseTime=Date.parse(`${button.dataset.date}T00:00:00Z`),position=Math.max(0,Math.min(100,(phaseTime-start)/(end-start)*100));button.hidden=false;button.style.left=`${position}%`;button.dataset.edge=position<3?"start":position>97?"end":"";});const first=new Date(start).getUTCFullYear(),last=+stops.at(-1)!.start_date.slice(0,4),step=innerWidth<700?4:2;for(let year=first;year<=last;year+=1){if(year!==first&&year!==last&&(year-first)%step!==0)continue;const node=document.createElement("span");node.textContent=String(year);node.style.left=`${Math.max(0,Math.min(100,(Date.UTC(year,0,1)-start)/(end-start)*100))}%`;ticks.appendChild(node);}};
  const applyFilter=()=>{stopPlay();stops=payload.stops.filter(stop=>filter.value==="solo"?stop.classification==="专场":filter.value==="festival"?stop.classification==="拼盘":true);const start=timelineStart(),end=time(stops.at(-1)!);range.min=String(start);range.max=String(end);range.step=String(DAY);index=Math.max(0,stops.findLastIndex(stop=>time(stop)<=Date.now()));buildTicks();render(index);};

  map.on("load",()=>{map.setProjection({type:"globe"});map.setSky({"sky-color":"#020914","sky-horizon-blend":.18,"horizon-color":"#0b2b3d","horizon-fog-blend":.35,"fog-color":"#07101c","fog-ground-blend":.5,"atmosphere-blend":["interpolate",["linear"],["zoom"],0,1,5,0]});map.setLight({anchor:"map",color:"#9ee8ff",intensity:.25,position:[1.2,210,35]});addLayers(map);applyFilter();status.textContent="GLOBE READY";container.dataset.ready="true";});
  map.on("click","journey-venue",(event:MapLayerMouseEvent)=>{const properties=event.features?.[0]?.properties as Record<string,string>|undefined;if(properties)new Popup({closeButton:false,offset:10}).setLngLat(event.lngLat).setDOMContent(popup(properties)).addTo(map);});
  map.on("error",()=>{status.textContent="VECTOR RETRY";});
  range.addEventListener("input",()=>{stopPlay();render(nearest(+range.value));});range.addEventListener("change",()=>render(nearest(+range.value),true));filter.addEventListener("change",applyFilter);window.addEventListener("resize",buildTicks);
  get<HTMLButtonElement>("[data-world-view]").addEventListener("click",()=>map.easeTo({center:[115,30],zoom:1.65,pitch:12,bearing:-8,duration:900}));
  phaseJumps.forEach(button=>button.addEventListener("click",()=>{stopPlay();render(closest(Date.parse(`${button.dataset.date}T00:00:00Z`)),true);}));
  const startPlay=()=>{if(index>=stops.length-1)render(0,true);playing=true;const token=++runId;play.dataset.playing="true";play.setAttribute("aria-pressed","true");playText.textContent=container.dataset.pauseLabel??"Pause";playSoundtrack();const advance=()=>{if(!playing||token!==runId)return;if(index>=stops.length-1){stopPlay();return;}animateTo(index+1,token,()=>{timer=setTimeout(()=>retractLatest(token,()=>{timer=setTimeout(advance,Math.round(500*speedScale()));}),Math.round(400*speedScale()));});};advance();};
  play.addEventListener("click",()=>{if(playing){stopPlay();return;}startPlay();});
  speed.addEventListener("change",()=>{if(playing){stopPlay();startPlay();}});document.addEventListener("visibilitychange",()=>{if(document.hidden)stopPlay();});
  soundtrackToggle.addEventListener("click",()=>{soundtrackEnabled=!soundtrackEnabled;soundtrackToggle.setAttribute("aria-pressed",String(soundtrackEnabled));soundtrackToggle.textContent=soundtrackEnabled?"BGM ON":"BGM OFF";if(soundtrackEnabled&&playing)playSoundtrack();else pauseSoundtrack();});
  const youtubeWindow=window as Window&{YT?:YouTubeApi;onYouTubeIframeAPIReady?:()=>void};
  const initializeYouTube=()=>{if(youtubePlayer||!youtubeWindow.YT)return;youtubePlayer=new youtubeWindow.YT.Player(youtubeFrame,{events:{onReady:()=>{youtubeReady=true;if(pendingSoundtrack&&playing)playSoundtrack();},onAutoplayBlocked:()=>{pendingSoundtrack=false;soundtrack.dataset.autoplayBlocked="true";},onError:()=>{soundtrackEnabled=false;soundtrackToggle.setAttribute("aria-pressed","false");soundtrackToggle.textContent="BGM ERROR";}}});};
  youtubeWindow.onYouTubeIframeAPIReady=initializeYouTube;if(youtubeWindow.YT)initializeYouTube();else{const script=document.createElement("script");script.src="https://www.youtube.com/iframe_api";script.async=true;document.head.appendChild(script);}
}

init().catch(error=>{console.error("Journey globe failed",error);if(root)root.dataset.error="true";});
