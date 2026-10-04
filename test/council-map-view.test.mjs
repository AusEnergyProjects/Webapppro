import test from "node:test";
import assert from "node:assert/strict";
import { mapWorldPoint, mapWorldPosition, councilMapPoint, fitCouncilMap, councilPreviewTiles, moveCouncilMap, layoutCouncilMapMarkers, preferredCouncilMapLayer } from "../src/lib/council-map-view.ts";
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

test("nearby postcode anchors stay geographic while overlapping labels are omitted", () => {
  const areas=["3805","3806","3977","3980"].map(key=>{const [lat,lng]=postcodeCoordinate(key);return {key,position:{lat,lng}};});
  for(const width of [260,300,355,1000]) {
    const height=width>500?590:390;
    const view=fitCouncilMap(areas.map(area=>area.position),width,height);
    const layout=layoutCouncilMapMarkers(areas,view,width,height);
    assert.equal(layout.anchors.length,4);
    assert.equal(layout.visible.length+layout.hidden,4);
    for(const marker of layout.anchors) {
      const actual=councilMapPoint(areas.find(area=>area.key===marker.key).position,view,width,height);
      assert.equal(marker.x,actual.x); assert.equal(marker.y,actual.y);
    }
    for(let i=0;i<layout.visible.length;i++) {
      const marker=layout.visible[i];
      assert.ok(marker.y+54<=height-82,"Postcode labels must clear the heat legend and attribution");
      const actual=councilMapPoint(areas.find(area=>area.key===marker.key).position,view,width,height);
      assert.equal(marker.x,actual.x);assert.equal(marker.y,actual.y);
      for(const other of layout.visible.slice(i+1))assert.ok(Math.abs(marker.x-other.x)>=94||Math.abs(marker.y-other.y)>=46,`${width}: ${marker.key} overlaps ${other.key}`);
    }
  }
});

const councilPostcodes = "3169 3172 3182 3183 3184 3186 3187 3188 3189 3190 3191 3192 3193 3194 3195 3196 3197 3202 3205 3206 3207 3804 3805 3806 3807 3808 3809 3810 3812 3813 3814 3815 3910 3911 3912 3913 3915 3916 3918 3919 3920 3922 3925 3926 3927 3928 3929 3930 3931 3933 3934 3936 3939 3940 3941 3942 3943 3944 3953 3956 3959 3975 3976 3977 3978 3979 3980 3981 3984 3991 3992 3995 3996".split(" ");
test("73-postcode extent retains every true centre without grid reflow or label collisions", () => {
  const areas=councilPostcodes.map(key=>{const coordinate=postcodeCoordinate(key);assert.ok(coordinate,key);return {key,position:{lat:coordinate[0],lng:coordinate[1]}};});
  assert.equal(areas.length,73);
  for(const [width,height] of [[260,390],[300,390],[355,390],[1000,590]]) {
    const view=fitCouncilMap(areas.map(area=>area.position),width,height);
    const layout=layoutCouncilMapMarkers(areas,view,width,height);
    assert.equal(layout.anchors.length,73);
    assert.ok(layout.hidden>0,"Dense maps must suppress labels instead of displacing them");
    for(const marker of layout.anchors)assert.deepEqual({x:marker.x,y:marker.y},councilMapPoint(areas.find(area=>area.key===marker.key).position,view,width,height));
    for(const [index,marker] of layout.visible.entries()) {
      assert.ok(marker.x>=50&&marker.x<=width-50&&marker.y>=60&&marker.y+54<=height-82);
      for(const other of layout.visible.slice(index+1))assert.ok(Math.abs(marker.x-other.x)>=94||Math.abs(marker.y-other.y)>=46);
      assert.ok(!layout.anchors.some(other=>other.key!==marker.key&&Math.abs(other.x-marker.x)<54&&other.y>marker.y+3&&other.y<marker.y+66),"A label must not cover another postcode marker");
    }
  }
});

test("selected postcode receives label priority without moving either anchor", () => {
  const view={lat:-38,lng:145,zoom:10},centre=mapWorldPoint(view,view.zoom);
  const areas=[{key:"a",position:view},{key:"b",position:mapWorldPosition({x:centre.x+80,y:centre.y},view.zoom)}];
  const normal=layoutCouncilMapMarkers(areas,view,800,590);
  const selected=layoutCouncilMapMarkers(areas,view,800,590,"b");
  assert.deepEqual(normal.anchors,selected.anchors);
  assert.deepEqual(normal.visible.map(marker=>marker.key),["a"]);
  assert.deepEqual(selected.visible.map(marker=>marker.key),["b"]);
});

test("public default prefers usable VEU data, then first known public layer, including real zeros", () => {
  const layer=(id,value,postcode="3805")=>({id,postcodes:[{postcode,value}]});
  assert.equal(preferredCouncilMapLayer([],councilPostcodes),"");
  assert.equal(preferredCouncilMapLayer([layer("solar",12),layer("public-upgrades",9)],councilPostcodes),"public-upgrades");
  assert.equal(preferredCouncilMapLayer([layer("solar",12),layer("public-upgrades",0)],councilPostcodes),"public-upgrades");
  for(const unknown of [null,NaN,Infinity,-1])assert.equal(preferredCouncilMapLayer([layer("public-upgrades",unknown),layer("solar",12)],councilPostcodes),"solar");
  assert.equal(preferredCouncilMapLayer([layer("public-upgrades",9,"9999"),layer("solar",0)],councilPostcodes),"solar");
  assert.equal(preferredCouncilMapLayer([layer("public-upgrades",null)],councilPostcodes),"");
});
