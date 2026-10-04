import test from "node:test";
import assert from "node:assert/strict";
import { mapWorldPoint, mapWorldPosition, councilMapPoint, fitCouncilMap, councilPreviewTiles, moveCouncilMap, layoutCouncilMapMarkers } from "../src/lib/council-map-view.ts";
import { postcodeCoordinate } from "../src/lib/postcode-distance.ts";

test("council overlay projection round-trips Australian locations across zoom levels", () => {
  for (const position of [{lat:-38.032,lng:145.35},{lat:-12.45,lng:130.8},{lat:-42.9,lng:147.3}]) {
    for (const zoom of [3,10,16]) {
      const result=mapWorldPosition(mapWorldPoint(position,zoom),zoom);
      assert.ok(Math.abs(result.lat-position.lat)<1e-9);
      assert.ok(Math.abs(result.lng-position.lng)<1e-9);
      assert.deepEqual(councilMapPoint(position,{...position,zoom},640,400),{x:320,y:200});
    }
  }
});

test("fit keeps approved postcode centres inside desktop and mobile map frames", () => {
  const positions=[{lat:-38.015,lng:145.30},{lat:-38.035,lng:145.35},{lat:-38.10,lng:145.28},{lat:-38.21,lng:145.39}];
  for (const [width,height] of [[1000,590],[300,390]]) {
    const view=fitCouncilMap(positions,width,height);
    for(const position of positions){const point=councilMapPoint(position,view,width,height);assert.ok(point.x>=0&&point.x<=width);assert.ok(point.y>=0&&point.y<=height);}
  }
  assert.equal(fitCouncilMap([],500,400).zoom,4);
});

test("demo requests only visible tiles, using the canonical HTTPS tile service", () => {
  const width=790,height=590,view={lat:-38.1,lng:145.3,zoom:10};
  const tiles=councilPreviewTiles(view,width,height);
  assert.ok(tiles.length<=20);
  assert.equal(new Set(tiles.map(tile=>tile.key)).size,tiles.length);
  for(const tile of tiles){assert.match(tile.url,/^https:\/\/tile\.openstreetmap\.org\/10\/\d+\/\d+\.png$/);assert.ok(tile.x<width&&tile.x+256>0&&tile.y<height&&tile.y+256>0);}
});

test("pan follows screen pixels and keeps coordinates finite near the world edges", () => {
  const view={lat:-38.1,lng:145.3,zoom:10};
  const moved=moveCouncilMap(view,100,0);
  assert.ok(moved.lng<view.lng);
  const point=councilMapPoint(view,moved,640,400);
  assert.ok(Math.abs(point.x-420)<1e-8);
  const edge=moveCouncilMap({lat:80,lng:179,zoom:3},-9000,9000);
  assert.ok(edge.lng>=-180&&edge.lng<=180&&edge.lat<=80&&edge.lat>=-80);
});

test("nearby southeast Melbourne postcode controls stay separately clickable on mobile", () => {
  const areas=["3805","3806","3977","3980"].map(key=>{const [lat,lng]=postcodeCoordinate(key);return {key,position:{lat,lng}};});
  for(const width of [260,300,355,1000]) {
    const height=width>500?590:390;
    const view=fitCouncilMap(areas.map(area=>area.position),width,height);
    const layout=layoutCouncilMapMarkers(areas,view,width,height);
    assert.equal(layout.hidden,0); assert.equal(layout.visible.length,4);
    for(let i=0;i<layout.visible.length;i++) {
      const marker=layout.visible[i];
      assert.ok(marker.y+66<=height-79,"Postcode labels must clear the heat legend and attribution");
      const actual=councilMapPoint(areas.find(area=>area.key===marker.key).position,view,width,height);
      assert.equal(marker.anchorX,actual.x);assert.equal(marker.anchorY,actual.y);
      for(const other of layout.visible.slice(i+1))assert.ok(Math.abs(marker.x-other.x)>=103||Math.abs(marker.y-other.y)>=116,`${width}: ${marker.key} overlaps ${other.key}`);
    }
  }
});
