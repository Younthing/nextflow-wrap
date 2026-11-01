/** A docked ligand pose (PDBQT) and a short peptide (PDB), small enough for mocks and stories. */
export const SAMPLE_PDBQT = `MODEL 1
REMARK VINA RESULT:    -7.4      0.000      0.000
ROOT
ATOM      1  C1  LIG A   1       0.000   0.000   0.000  1.00  0.00     0.020 C
ATOM      2  C2  LIG A   1       1.394   0.000   0.000  1.00  0.00     0.002 A
ATOM      3  C3  LIG A   1       2.091   1.207   0.000  1.00  0.00     0.002 A
ATOM      4  C4  LIG A   1       1.394   2.414   0.000  1.00  0.00     0.002 A
ATOM      5  C5  LIG A   1       0.000   2.414   0.000  1.00  0.00     0.002 A
ATOM      6  C6  LIG A   1      -0.697   1.207   0.000  1.00  0.00     0.002 A
ATOM      7  O1  LIG A   1       3.461   1.207   0.000  1.00  0.00    -0.361 OA
ENDROOT
TORSDOF 1
ENDMDL
`;

export const SAMPLE_PDB = `HEADER    PEPTIDE
ATOM      1  N   GLY A   1      -1.195   0.000   0.000  1.00  0.00           N
ATOM      2  CA  GLY A   1       0.000   0.000   0.000  1.00  0.00           C
ATOM      3  C   GLY A   1       1.250   0.800   0.000  1.00  0.00           C
ATOM      4  O   GLY A   1       1.250   2.030   0.000  1.00  0.00           O
ATOM      5  N   ALA A   2       2.400   0.100   0.000  1.00  0.00           N
ATOM      6  CA  ALA A   2       3.700   0.700   0.000  1.00  0.00           C
ATOM      7  C   ALA A   2       4.900  -0.200   0.000  1.00  0.00           C
ATOM      8  O   ALA A   2       4.800  -1.430   0.000  1.00  0.00           O
ATOM      9  CB  ALA A   2       3.800   1.600   1.230  1.00  0.00           C
END
`;
