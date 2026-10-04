export type MapPosition = { lat: number; lng: number };
export type CouncilMapView = MapPosition & { zoom: number };
export const MAP_MIN_ZOOM = 3;
export const MAP_MAX_ZOOM = 16;

export function mapWorldPoint(position: MapPosition, zoom: number) {
  const size = 256 * 2 ** zoom;
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, position.lat));
  const sine = Math.sin(latitude * Math.PI / 180);
  return { x: (position.lng + 180) / 360 * size, y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * size };
}

export function mapWorldPosition(point: { x: number; y: number }, zoom: number): MapPosition {
  const size = 256 * 2 ** zoom;
  return { lng: point.x / size * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * point.y / size))) * 180 / Math.PI };
}

export function fitCouncilMap(positions: MapPosition[], width: number, height: number): CouncilMapView {
  if (!positions.length) return { lat: -25.5, lng: 134, zoom: 4 };
  const points = positions.map(position => mapWorldPoint(position, 0));
  const west = Math.min(...points.map(point => point.x)), east = Math.max(...points.map(point => point.x));
  const north = Math.min(...points.map(point => point.y)), south = Math.max(...points.map(point => point.y));
  const centre = mapWorldPosition({ x: (west + east) / 2, y: (north + south) / 2 }, 0);
  const fit = Math.floor(Math.log2(Math.min(Math.max(width - 130, 100) / Math.max(east - west, 0.01), Math.max(height - 150, 100) / Math.max(south - north, 0.01))));
  return { ...centre, zoom: Math.max(MAP_MIN_ZOOM, Math.min(13, fit)) };
}

export function councilMapPoint(position: MapPosition, view: CouncilMapView, width: number, height: number) {
  const point = mapWorldPoint(position, view.zoom), centre = mapWorldPoint(view, view.zoom);
  return { x: point.x - centre.x + width / 2, y: point.y - centre.y + height / 2 };
}

// Only tiles intersecting the visible preview are requested. Browser HTTP caching
// applies; there is no tile prefetch, proxy, background download or offline cache.
export function councilPreviewTiles(view: CouncilMapView, width: number, height: number) {
  const centre = mapWorldPoint(view, view.zoom), left = centre.x - width / 2, top = centre.y - height / 2;
  const count = 2 ** view.zoom;
  const tiles: Array<{ key: string; x: number; y: number; url: string }> = [];
  for (let y = Math.floor(top / 256); y <= Math.floor((top + height - 1) / 256); y++) {
    for (let x = Math.floor(left / 256); x <= Math.floor((left + width - 1) / 256); x++) {
      if (y < 0 || y >= count) continue;
      const wrapped = ((x % count) + count) % count;
      tiles.push({ key: `${view.zoom}/${wrapped}/${y}`, x: x * 256 - left, y: y * 256 - top, url: `https://tile.openstreetmap.org/${view.zoom}/${wrapped}/${y}.png` });
    }
  }
  return tiles;
}

export function moveCouncilMap(view: CouncilMapView, dx: number, dy: number): CouncilMapView {
  const centre = mapWorldPoint(view, view.zoom);
  const next = mapWorldPosition({ x: centre.x - dx, y: centre.y - dy }, view.zoom);
  return { lat: Math.max(-80, Math.min(80, next.lat)), lng: ((next.lng + 540) % 360) - 180, zoom: view.zoom };
}

/** Declutter display labels only; leader lines retain each actual postcode anchor. */
export function layoutCouncilMapMarkers(areas: Array<{key:string;position:MapPosition}>, view: CouncilMapView, width: number, height: number) {
  const visible: Array<{key:string;x:number;y:number;anchorX:number;anchorY:number}> = [];
  const inFrame: Array<{key:string;anchorX:number;anchorY:number}> = [];
  let hidden = 0;
  const halfWidth=48,topSpace=88,bottomSpace=145;
  for(const area of areas) {
    const anchor=councilMapPoint(area.position,view,width,height);
    if(anchor.x < -50 || anchor.x > width+50 || anchor.y < -65 || anchor.y > height+65)continue;
    inFrame.push({key:area.key,anchorX:anchor.x,anchorY:anchor.y});
    const candidates=[{x:anchor.x,y:anchor.y}];
    for(let ring=1;ring<=5;ring++)for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]])candidates.push({x:anchor.x+dx*ring*103,y:anchor.y+dy*ring*116});
    const candidate=candidates.map(point=>({x:Math.max(halfWidth+8,Math.min(width-halfWidth-8,point.x)),y:Math.max(topSpace,Math.min(height-bottomSpace,point.y))}))
      .find(point=>visible.every(other=>Math.abs(other.x-point.x)>=103 || Math.abs(other.y-point.y)>=116));
    if(candidate)visible.push({key:area.key,...candidate,anchorX:anchor.x,anchorY:anchor.y});
    else hidden++;
  }
  // A compact viewport can fit a neat grid even when a central first label
  // prevents greedy placement. Reflow the labels, retaining geographic leaders.
  const columns=Math.max(1,Math.floor((width-16)/103));
  const rows=Math.max(1,Math.floor((height-topSpace-bottomSpace)/116)+1);
  if(hidden>0&&inFrame.length<=columns*rows) {
    const slots:Array<{x:number;y:number}>=[];
    for(let row=0;row<rows;row++)for(let column=0;column<columns;column++)slots.push({
      x:columns===1?width/2:halfWidth+8+column*(width-2*(halfWidth+8))/(columns-1),
      y:rows===1?(topSpace+height-bottomSpace)/2:topSpace+row*(height-topSpace-bottomSpace)/(rows-1),
    });
    const arranged=inFrame.map(marker=>{
      const ranked=slots.map((slot,index)=>({index,distance:(slot.x-marker.anchorX)**2+(slot.y-marker.anchorY)**2})).sort((a,b)=>a.distance-b.distance);
      const [slot]=slots.splice(ranked[0].index,1);
      return {...marker,...slot};
    });
    return {visible:arranged,hidden:0};
  }
  return {visible,hidden};
}
