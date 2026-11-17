// Neon Streets — screenshot scenes. One job: given ?shot=<scene> in the URL,
// set the game up deterministically for that shot (fixed places, fixed time)
// so the dossier screenshots are real renders of the game's own code.
// Scenes: title, drive, chase, complete. main.js sets window.__shotReady
// once the scene has rendered a few frames.

export function shotName() {
  const q = new URLSearchParams(window.location.search);
  return q.get('shot') || null;
}

// G is the game context main.js builds: { player, playerCar, traffic, police,
// missions, hud, setState, startMission, showCompleteScreen, showTitleScreen,
// money, setMoney }.
export function setupShot(name, G) {
  if (name === 'title') {
    G.showTitleScreen();
    // A cinematic look over the city: park the camera high, looking down a
    // neon avenue, with a few traffic cars rolling past.
    G.cinematic = { pos: [-40, 26, 120], look: [30, 2, -40] };
    G.traffic.spawnInitial(10);
    G.traffic.spawnPeds(6);
    return true;
  }
  if (name === 'drive') {
    G.hideTitle();
    G.startMission(0);
    G.setPlayerAt(-96, -40, 0, 16);
    G.traffic.spawnInitial(12);
    G.traffic.spawnPeds(6);
    G.police.setWanted(0);
    G.setMoney(100);
    return true;
  }
  if (name === 'chase') {
    G.hideTitle();
    G.startMission(3);
    G.setPlayerAt(-40, -48, Math.PI / 2, 24);
    G.traffic.spawnInitial(8);
    G.police.setWanted(3);
    G.police.placeNear(-40, -48);
    G.setMoney(350);
    return true;
  }
  if (name === 'complete') {
    G.hideTitle();
    G.startMission(0);
    G.setPlayerAt(-96, -88, 0, 0);
    G.traffic.spawnInitial(8);
    G.police.setWanted(0);
    G.setMoney(100);
    G.showCompleteScreen('First Drive', 100, 'Finished in 41 s · no damage taken');
    return true;
  }
  return false;
}
