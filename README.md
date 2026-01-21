# Geano's Jump'n'Run Editor

Turn your FoundryVTT Scenes into playable Prince of Persia style platformer levels!

## Description

**Jump'n'Run** transforms the standard top-down Foundry VTT experience into a side-scrolling platformer. It introduces a physics engine, player controller, and level design tools allowing Game Masters to build challenging obstacle courses, puzzles, and action levels directly within Foundry.

Whether you want a simple jumping puzzle or a full-blown Metroidvania adventure, this module provides the tools to make it happen.

## Features

- **Side-Scrolling Physics**: Real-time gravity, jumping, wall-jumping, and collision detection.
- **Classic Controls**: Intuitive WASD or Arrow Key movement with Space to jump.
- **Multiplayer Support**: Fully networked movement—watch your friends jump and fall in real-time.
- **Level Editor Tools**:
  - **Platforms & Walls**: Define the physical geometry of your level.
  - **Hazards**: Spikes and other dangers that damage players.
  - **Background Parallax**: Create depth with scrolling background layers (Scene Config).
- **Game Mechanics**:
  - **Hearts System**: Classic retro-style health tracking.
  - **Potions**: Placeable healing items.
  - **Checkpoints**: Set spawn points for players to restart from.
- **Integration**:
  - **Monk's Active Tile Triggers (MATT)**: Utilize custom triggers and actions for advanced logic.

## Installation

1.  Copy the module's manifest URL: `https://github.com/GeanoFee/geanos-foundry-jump-n-run-level-editor/releases/latest/download/module.json`
2.  In FoundryVTT, go to **Add-on Modules** -> **Install Module**.
3.  Paste the URL and click **Install**.

## Usage

### 1. Activating a Scene
To turn a standard Scene into a Jump'n'Run level:
1.  Open the **Scene Configuration**.
2.  Go to the new **Jump'n'Run** tab.
3.  Check **Enable Jump'n'Run Mode**.
4.  (Optional) Configure **Gravity Force**, **Movement Speed**, and **Parallax** settings.

### 2. Building the Level
Use the **Jump'n'Run Tools** (Run icon) in the toolbar:
-   **Draw Platform**: Create solid ground.
-   **Draw Wall**: Create vertical barriers.
-   **Draw Hazard**: Create areas that deal damage.
-   **Draw Portal**: Teleport players between locations.
-   **Draw Checkpoint**: Set respawn points.

*Tip: You can hide the hitboxes from players in the module settings for a more immersive look.*

### 3. Controls
Players control their assigned Token:
-   **Move Left/Right**: `A` / `D` or `Left Arrow` / `Right Arrow`
-   **Jump**: `Space` / `W`
-   **Crouch/Drop**: `S` or `Down Arrow` (pass through some platforms)
-   **Wall Jump**: Press Jump while sliding down a wall.

## Monk's Active Tile Triggers (MATT) Integration

This module adds custom Triggers and Actions to MATT, allowing for complex level scripting.

### Triggers
-   `Jump'n'Run: Player Death`
-   `Jump'n'Run: Health Change`
-   `Jump'n'Run: Portal Use`
-   `Jump'n'Run: Checkpoint Reached`
-   `Jump'n'Run: Item Collected`
-   `Jump'n'Run: Wall Jump`

### Actions
-   **Reset Hearts**: Restore a player's health to full.
-   **Modify Hearts**: Heal (positive) or Damage (negative) a player.
-   **Toggle Gravity**: Invert or disable gravity for the scene (0.0 to 1.0 toggle).





