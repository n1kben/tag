# Reverse-engineering Boomerang Fu's physics and game feel

**Boomerang Fu achieves its acclaimed "game feel" through a deceptively simple system: free analog movement with inertia, physics-based 2D boomerang trajectories that curve and ricochet, and one-hit kills amplified by generous juice (slow-motion, screen shake, freeze frames).** Built in Unity by solo developer Paul Kopetko over five years, the game won Best Gameplay at the 2020 Australian Game Developer Awards and sold over one million copies. Its three-button control scheme (slash, throw, dash) masks surprising mechanical depth — curved trick shots, parry timing, and 14 stackable power-ups that radically alter base physics. Here is everything documented about its systems, gathered from developer interviews, the game's wiki, Steam data, and detailed reviews.

## Free analog movement with deliberate slide and momentum

Boomerang Fu uses **free analog movement** — not grid-based, not tile-snapped. Players control food-item characters with one analog stick across small, single-screen top-down arenas. The stick doubles as the aiming reticle for throws, meaning movement direction and aim are always coupled.

The game is consistently described as a "physics party game" and "physics-based brawler," and several design details confirm characters carry **inertia**. The game includes an explicit "edge safety" accessibility setting that either "gently nudges players away from edges" or "blocks them from falling off entirely" — a feature that only makes sense if momentum can carry characters past platform boundaries. The base movement speed is moderate-to-fast, tuned to the arena sizes (most arenas fit a single screen). The **Caffeinated power-up** boosts movement speed and shortens dash cooldown, confirming base speed is a deliberate balance point.

The **dash mechanic** is a core action mapped to its own button. Pressing dash executes a quick directional lunge in the movement direction. Dash serves triple duty: evading incoming boomerangs, jumping over gaps between platforms, and aggressive repositioning. The **Dash Through Walls** power-up allows phasing through solid obstacles during a dash, and the **Stab power-up** makes the melee slash move "3x the amount you usually would" — both confirming that dashes and slashes carry forward impulse rather than being instantaneous teleports. The melee slash itself has inherent forward momentum, a short lunge that closes distance.

The overall feel is **slidey and slightly weighty**. Characters don't stop on a dime. This creates the party-game chaos Kopetko was aiming for — players frequently overshoot, slide off ledges, and collide with traps because of residual momentum.

## Boomerang trajectories rely on 2D physics with curve, growth, and ricochet

The boomerang is the singular central mechanic, and its physics are the game's most complex system. Throws follow a **2D physics simulation** that creates what the developer calls "unpredictable yet fair trajectories."

**Throwing** sends the boomerang in the analog stick's direction. Holding the throw button charges the throw for more precise aiming before release. The boomerang's trajectory curves based on the physics simulation — the official description repeatedly emphasizes that players can "curve your throws around corners to become a powerful boomerang assassin." This curving appears influenced by the player's movement vector at the moment of release, creating natural arcs rather than straight-line projectiles. A critical detail for replication: **the boomerang grows larger the further it travels**, increasing its effective hit area but simultaneously slowing down. This creates a natural risk-reward dynamic between close-range speed and long-range coverage.

**Ricochet** is core to advanced play. Boomerangs bounce off walls, enabling trick shots around corners and multi-surface bank shots. When a boomerang hits a wall or obstacle, it reflects and continues. When it hits a player, it kills them and drops to the floor. The **return mechanic** works two ways: unobstructed boomerangs automatically fly back to the player's hands (the return path is lethal — a key advanced tactic), while boomerangs that hit obstacles and fall to the ground can be recalled by holding the throw button, pulling them back along a lethal return path. Poorly aimed throws can rebound and kill the thrower.

An optional **subtle aim assist** nudges thrown boomerangs slightly toward enemy players. Kopetko described this as a system that gives "a higher chance of hitting the intended target" but "not too much, so most kills still feel intentional." The **Telekinesis power-up** allows full manual mid-flight steering of the boomerang, though it moves significantly slower when controlled this way.

## Collision, combat, and the one-hit-kill philosophy

The combat system is built on **one-hit kills** — a single boomerang strike or melee slash instantly eliminates a target, splitting the food character in half in a stylized Fruit Ninja effect. This design choice is the foundation of the game's tension. The sole exception is the **Shield power-up**, which lets a player survive one extra hit.

**Melee combat** uses the slash button for a close-range attack with forward lunge. Players can slash even without holding a boomerang — weaponless slashes push opponents off ledges. The most skilful mechanic is the **parry system**: a well-timed slash deflects incoming boomerangs mid-air, triggering slow-motion effects and controller vibration as feedback. The Unstoppable power-up counters this by making thrown boomerangs undeflectable.

Characters collide with walls and obstacles normally — they cannot walk through them unless using Dash Through Walls during a dash. Environmental hazards include sliding wall traps (activated by levers), moving platforms, giant rolling pins, crumbling bridges, spinning platforms, teleporter portals (which transport both players and boomerangs), water hazards (instant death), and tall grass that hides players. A "kill zone" mechanic closes the arena boundary in prolonged rounds to force confrontation.

## Fourteen power-ups that systematically modify base physics

Power-ups spawn as blue books on the map. Players stack up to **3 simultaneously** (a 4th replaces the oldest). All power-ups combine with each other, creating emergent combo effects. Fire and Ice are the only mutual exclusion. Here is the complete roster and how each modifies the physics:

**Boomerang modifiers:** Multi Boomerang splits throws into 4–5 boomerangs in a shotgun-like fan spread. Extra Boomerang grants a second independent boomerang. Fire Boomerang leaves a lingering fire trail that deals area-denial damage. Ice Boomerang leaves an ice trail that freezes opponents on contact and causes anyone walking over it to slide (directly modifying floor friction). Explosive Boomerang adds a blast radius after a countdown or on impact, destroying destructible environment objects. Teleport Boomerang lets the player teleport to the boomerang's location after throwing. Telekinesis enables manual mid-flight steering within a radius at reduced speed.

**Player modifiers:** Caffeinated increases movement speed and shortens dash cooldown. Dash Through Walls enables phasing through solid obstacles during dashes. Shield adds one extra hit point (does not count toward the 3-power-up limit). Disguise transforms the idle player into a random environmental prop. Decoy spawns an AI-controlled clone that walks around as a distraction.

**Special:** Bamboozled is a negative power-up that inverts movement controls temporarily (never spawns as a player's first power-up). Battle Royale shrinks the arena boundary toward the holder's position. Stacking creates powerful combinations — Ice + Explosive produces freezing explosions, Multi + Fire creates multiple fire-trailing boomerangs, Teleport + Multi teleports to the first of the spread boomerangs.

## Unity engine, FMOD audio, and a solo developer's five-year build

Boomerang Fu was built in **Unity** with **FMOD** for audio implementation. Paul Kopetko — a professional sound designer and musician by trade — created the game over five years as a side project alongside his audio work at Featherweight Games. He handled design, development, sound design, and publishing solo, contracting specialists for art (Julian Wilton of Massive Monster / Cult of the Lamb fame served as art director; Gavin Kusters, David Smith, and Teja Godson handled 3D art) and console porting (The Knights of U handled Xbox, PlayStation, and Switch ports, optimization, QA, and certification).

**No formal GDC talk, postmortem, or technical blog post exists** about the game's implementation. Kopetko exhibited a playable demo at GDC 2019 at Microsoft's ID@Xbox booth and won the PAX 10 Award at PAX West 2019, but never delivered a presentation. The most substantial interview is a ~28-minute appearance on the Lightmap/Pixel Sift podcast (September 2020). In a SIFTER interview, Kopetko noted the game "went far beyond my expectations" and that the second year outsold the first, driven by word-of-mouth. His design inspirations were **Overcooked, TowerFall, and Lovers in a Dangerous Spacetime** — all accessible party games with emergent depth.

Kopetko's sound design philosophy directly shapes game feel: "My sound design was heavily inspired by the 70s anime and Hong Kong action cinema I used to watch on SBS as a teenager, and it was a joy creating my own bespoke pings, zaps and kung fu punch effects." Each food character has unique death audio (coffee mug shattering, watermelon slicing), which reviewers consistently cited as elevating impact feedback.

## Characters are purely cosmetic — shape does not affect physics

Despite the roster of **22 anthropomorphic food characters** (Milk, Coffee, Carrot, Bacon, Avocado, Eggplant, Ice Cream, Sushi, Watermelon, Donut, Bread, Banana, Hot Sauce, Burger, Boba Tea, Fries, Ramen, Pineapple, Chocolate, Salt & Pepper, Jello, Grapes), **all characters share identical gameplay hitboxes, movement speed, and collision properties**. The art is purely cosmetic. Patch notes confirm that visual size adjustments (e.g., Coffee "made to look 5% smaller") did not change collision data. The one minor exception: in Hide and Seek mode, shorter characters like Ramen hide better in tall grass.

Characters are 3D-modeled with a soft, rounded, toy-like aesthetic — bright saturated colors, exaggerated proportions (large bodies, tiny limbs), and expressive googly-eyed faces. Julian Wilton's art direction gives them a distinctive charm that reads clearly amid fast-paced chaos. Death animations split characters to reveal food-appropriate interiors. Unlockable cosmetic accessories (hats, outfits) are earned through XP progression.

The camera uses a **top-down perspective with a slight isometric tilt** and dynamically zooms in/out to keep all players on screen — essential for the single-screen arena design across 57 total maps.

## Replicating the feel requires nailing five specific systems

For anyone seeking to recreate Boomerang Fu's movement style, the research points to five essential systems working in concert.

**First, inertia-based analog movement** — characters must slide and carry momentum, with a moderate base speed that makes dashing feel impactful by contrast. **Second, physics-simulated boomerang trajectories** — the 2D physics create the curving, ricocheting, growing-with-distance behavior that makes every throw feel unique. Straight-line projectiles would destroy the game's identity. **Third, the one-hit-kill plus parry dynamic** — instant lethality creates tension, while parrying provides a skill ceiling. **Fourth, generous juice** — slow-motion on kills and parries, freeze frames on impact, screen shake on explosions, controller vibration, and a kill replay on the final elimination of each round. All of these are individually toggleable in Boomerang Fu's settings, suggesting Kopetko iterated on each independently. **Fifth, power-up stacking that compounds physics modifications** — the combinatorial explosion of 14 power-ups (up to 3 simultaneously) means the base physics system must be modular enough to accept layered modifications to trajectory, speed, area effects, and player movement without breaking.

The game runs comfortably on low-end hardware (Intel i5-5257U, 4GB RAM, GTX 1050), confirming the physics simulation is lightweight — likely standard Unity 2D physics (Rigidbody2D, CircleCollider2D) rather than any custom physics engine. The entire design philosophy centers on accessibility: three buttons, instant readability, and "anyone can play immediately, but hardcore players will love mastering the advanced techniques."
