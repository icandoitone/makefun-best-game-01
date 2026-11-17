// Neon Streets — the entry program (Node 22, standard library only).
//
// It hands the game in: the playable game lives in game/ as plain static
// files (game/index.html and its modules, three.js vendored under
// game/vendor/), and screenshots/ holds 3 or 4 real renders of the game.
// This program copies both into the output directory and writes
// dossier.json with the vendored make.fun dossier builder.
//
// Run it outside the grader with MAKEFUN_OUTPUT_DIR set:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The scorer's caps for this bounty (reference/gate.json): the text cap is
// the only one that shapes the dossier bytes; the rest refuse an entry the
// scorer would refuse (too many screenshots or one too large; too many
// files or bytes in game/; a path under game/ that is too long).
const DOSSIER_LIMITS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function handIn() {
  const root = dirname(fileURLToPath(import.meta.url));
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });

  // The playable game, exactly as it sits in this repository.
  cpSync(join(root, 'game'), join(outDir, 'game'), { recursive: true });

  // The screenshots, if they are present (the first by name is the cover).
  const shotsOut = join(outDir, 'screenshots');
  mkdirSync(shotsOut, { recursive: true });
  const shotsIn = join(root, 'screenshots');
  if (existsSync(shotsIn)) cpSync(shotsIn, shotsOut, { recursive: true });

  // The judge's view of the entry, built by the kit's own library.
  const dossier = buildDossier(outDir, DOSSIER_LIMITS);
  writeFileSync(join(outDir, 'dossier.json'), dossier);
  return outDir;
}

const dest = handIn();
console.log('Neon Streets handed in to ' + dest);
