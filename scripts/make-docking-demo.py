"""Writes the docking demo inputs: a receptor PDBQT, a ligand SMILES table and the search box.

Usage: python3 scripts/make-docking-demo.py OUT_DIR

Writes OUT_DIR/receptor.pdbqt, OUT_DIR/ligands.csv and OUT_DIR/box.json, and prints the receptor source.

Receptor source:
1. DOCKING_RECEPTOR_PDBQT, a prepared receptor you already have (set DOCKING_BOX to "x,y,z,size" for its pocket).
2. A deterministic synthetic pocket: a half-open shell of polar and apolar atoms around the origin. It has no
   biological meaning; it gives Vina a cavity so the pipeline, the scores and the 3D view are exercised offline.

Only the standard library is needed here. Docking itself needs vina, meeko and rdkit
(python3 -m pip install vina meeko gemmi scipy rdkit).
"""

import json
import math
import os
import shutil
import sys

LIGANDS = [
    ("aspirin", "CC(=O)OC1=CC=CC=C1C(=O)O"),
    ("ibuprofen", "CC(C)CC1=CC=C(C=C1)C(C)C(=O)O"),
    ("caffeine", "CN1C=NC2=C1C(=O)N(C(=O)N2C)C"),
]

# AutoDock atom types around the pocket, cycling so the cavity has donors, acceptors and carbons.
TYPES = [("C", "C", 0.0), ("OA", "O", -0.4), ("C", "C", 0.1), ("NA", "N", -0.3), ("A", "C", 0.0), ("N", "N", -0.2)]


def synthetic_pocket(path, radius=7.5):
    lines = []
    serial = 1
    golden = math.pi * (3 - math.sqrt(5))
    points = 240
    for i in range(points):
        z = 1 - 2 * (i + 0.5) / points
        if z > 0.35:  # leave the top open so ligands can enter
            continue
        r = math.sqrt(1 - z * z)
        theta = golden * i
        x, y = radius * r * math.cos(theta), radius * r * math.sin(theta)
        ad_type, element, charge = TYPES[i % len(TYPES)]
        residue = 1 + serial // 6
        lines.append(
            f"ATOM  {serial:5d}  {element:<3s} POC A{residue:4d}    {x:8.3f}{y:8.3f}{z * radius:8.3f}  1.00  0.00    {charge:6.3f} {ad_type:<2s}"
        )
        serial += 1
    with open(path, "w") as handle:
        handle.write("REMARK synthetic pocket for the Nextflow Studio docking demo\n")
        handle.write("\n".join(lines) + "\nTER\nEND\n")


def main(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    receptor = os.path.join(out_dir, "receptor.pdbqt")
    given = os.environ.get("DOCKING_RECEPTOR_PDBQT")
    if given:
        shutil.copyfile(given, receptor)
        x, y, z, size = (float(v) for v in os.environ.get("DOCKING_BOX", "0,0,0,20").split(","))
        source = f"receptor {given}"
    else:
        synthetic_pocket(receptor)
        x, y, z, size = 0.0, 0.0, 0.0, 18.0
        source = "synthetic pocket"
    with open(os.path.join(out_dir, "ligands.csv"), "w") as handle:
        handle.write("name,smiles\n")
        handle.writelines(f"{name},{smiles}\n" for name, smiles in LIGANDS)
    with open(os.path.join(out_dir, "box.json"), "w") as handle:
        json.dump({"center_x": x, "center_y": y, "center_z": z, "size": size}, handle)
    print(source)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
