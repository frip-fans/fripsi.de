import { chromium } from "playwright";

const baseUrl=process.env.VISUAL_BASE_URL||"http://127.0.0.1:4321";
const browser=await chromium.launch({headless:true,args:["--enable-webgl","--use-gl=angle","--use-angle=swiftshader"]});

async function check(viewport,outputPath){
  const context=await browser.newContext({viewport,deviceScaleFactor:1});
  await context.addCookies([{name:"frip_fan_official_notice",value:"yes",url:baseUrl}]);
  const page=await context.newPage(),errors=[],requests=[];
  page.on("pageerror",error=>errors.push(`pageerror: ${error.message}`));
  page.on("console",message=>{const text=message.text();if(message.type()==="error"&&!text.includes("Executing inline script violates")&&!text.includes("static.cloudflareinsights.com"))errors.push(`console: ${text}`);});
  page.on("response",response=>{if(response.url().includes("tiles.openfreemap.org"))requests.push({url:response.url(),status:response.status()});});
  page.on("requestfailed",request=>{const failure=request.failure()?.errorText;if(request.url().includes("openfreemap")&&failure!=="net::ERR_ABORTED")errors.push(`requestfailed: ${failure}`);});
  await page.goto(`${baseUrl}/journey`,{waitUntil:"domcontentloaded"});
  await page.locator("[data-live-journey][data-ready='true']").waitFor({timeout:30_000});
  await page.waitForTimeout(1500);
  const events=Number(await page.locator("[data-summary-field='events']").textContent());
  const ticks=await page.locator("[data-year-ticks] span").count();
  const phaseMarker=await page.locator("[data-phase-jump]:visible").count();
  const soundtrackSrc=await page.locator("[data-youtube-frame]").getAttribute("src");
  const canvas=await page.locator(".maplibregl-canvas").count();
  const status=await page.locator("[data-map-status]").textContent();
  const beforeZoom=requests.length;
  for(let count=0;count<3;count+=1)await page.locator(".maplibregl-ctrl-zoom-in").click();
  await page.waitForTimeout(1800);
  const range=page.locator("[data-journey-range]"),minimum=await range.getAttribute("min");
  if(minimum)await range.fill(minimum);
  await page.locator("[data-journey-play]").click();
  await page.waitForTimeout(1900);
  const progress=await page.locator("[data-journey-progress]").textContent();
  await page.locator("[data-journey-play]").click();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  const layout=await page.evaluate(()=>Object.fromEntries([".journey-map-stage",".journey-soundtrack",".journey-current",".journey-console"].map(selector=>{const box=document.querySelector(selector)?.getBoundingClientRect();return[selector,box?{top:box.top,right:box.right,bottom:box.bottom,left:box.left}:null]})));
  if(events<1||ticks<5||phaseMarker!==3||canvas!==1||status!=="GLOBE READY")errors.push(`state: events=${events}, ticks=${ticks}, phaseMarker=${phaseMarker}, canvas=${canvas}, status=${status}`);
  if(requests.some(request=>request.status>=400))errors.push("vector response >=400");
  if(requests.length<=beforeZoom)errors.push("zoom did not request more vector resources");
  if(!soundtrackSrc?.includes("MfWqe_cb9rA")||!soundtrackSrc.includes("sHaQijiyhMk")||!soundtrackSrc.includes("loop=1"))errors.push("soundtrack playlist is incomplete");
  if(!progress||progress.startsWith("1 /"))errors.push(`playback did not advance: ${progress}`);
  if(overflow>1)errors.push(`horizontal overflow: ${overflow}px`);
  if(viewport.width<=850){
    const stage=layout[".journey-map-stage"],soundtrack=layout[".journey-soundtrack"],current=layout[".journey-current"],consolePanel=layout[".journey-console"];
    if(!stage||!soundtrack||!current||!consolePanel)errors.push("mobile layout element missing");
    else{
      if(soundtrack.top<stage.bottom-1)errors.push("soundtrack overlaps map stage");
      if(consolePanel.top<stage.bottom-1)errors.push("console overlaps map stage");
      if(soundtrack.top<consolePanel.bottom-1)errors.push("soundtrack overlaps console");
      if(current.bottom>stage.bottom+1)errors.push("current event card escapes map stage");
    }
  }
  await page.screenshot({path:outputPath,fullPage:true});
  await context.close();
  return{viewport,outputPath,events,ticks,phaseMarker,status,vectorRequests:requests.length,zoomRequests:requests.length-beforeZoom,progress,layout,errors};
}

const results=[await check({width:1440,height:1000},"/tmp/frip-journey-globe-desktop.png"),await check({width:390,height:844},"/tmp/frip-journey-globe-mobile.png")];
await browser.close();
if(results.some(result=>result.errors.length))throw new Error(JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
