---
ward: 22
revision: null
name: "Physics Stabilization Layer"
epic: "library-maturity"
status: "planned"
dependencies: [16]
layer: "rust"
estimated_tests: 4
created: "2026-03-31"
completed: null
---
# Ward 022: Physics Stabilization Layer

## Scope
Tilføj neighbor springs, shape-preservering og optional substeps/semi-implicit integration til fysikmotoren for at forhindre eksplosion, stretch og drifting under store kræfter. Stabiliserer mass-spring systemet fra Ward 6 via Ward 16's korrekte kapacitetsstyring, så partikler holder deres relative positioner og form.

## Inputs
- Kapacitetskorrekthed og grow-semantik fra Ward 16 (korrekt buffer resize)
- Eksisterende mass-spring kernel (Ward 6) med Hooke's lov og damping

## Outputs
- Neighbor spring constraints mellem tilstødende partikler
- Shape preservation heuristik (area/centroid conservation)
- Optional substep-parameter for finere integration
- Bruges af Ward 023 (tension, damping, substeps exposed som config)

## Specification

### Neighbor Springs
- Hver partikel forbindes til sine N nærmeste naboer med springs (rest length = initial afstand)
- Spring-kraft: `F = -k_neighbor * (distance - rest_length) * direction`
- `k_neighbor` er separat fra primær spring stiffness, default lavere (shape-preserving, ikke dominant)
- Nabopar beregnes én gang ved init og caches (ændres kun ved entity add/remove)

### Shape Preservation Heuristik
- Beregn polygon-areal af partikelgruppen hvert frame via Shoelace formula
- Sammenlign med reference-areal (beregnet ved init)
- Anvend korrektionskraft mod centroid hvis areal afviger > threshold (e.g. 5%)
- Korrektionskraft: radial push/pull proportional med areal-afvigelse

### Substeps og Semi-Implicit Integration
- Optional `substeps: u32` parameter (default 1)
- Hvert physics frame opdeles i `substeps` mini-steps med `dt / substeps`
- Semi-implicit Euler: opdatér velocity først, derefter position (i stedet for explicit Euler)
- Stabiliserer systemet under store dt-værdier og stive springs

### Centroid Anchoring
- Beregn centroid af partikelgruppen hvert frame
- Anvend svag kraft der trækker centroid mod `base_pos` (elementets DOM-position)
- Forhindrer drift under langvarig animation

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_neighbor_springs_resist_stretch` | Partikler forbundet med neighbor springs holder afstand inden for tolerance efter ekstern kraft |
| 2 | `test_shape_area_preserved_under_deformation` | Polygon-areal af partikelgruppe afviger < 10% fra reference efter kraftig deformation |
| 3 | `test_substeps_improve_stability` | Simulation med substeps=4 har lavere max velocity end substeps=1 under identisk kraft |
| 4 | `test_centroid_stays_near_base_pos` | Partikelgruppens centroid drifter ikke mere end threshold fra base_pos over 1000 frames |

## Must NOT
- Ikke ændre eksisterende buffer layout (FLOATS_PER_ENTITY forbliver 8)
- Ikke gøre neighbor springs obligatoriske for eksisterende simpel simulation
- Ikke hardcode substep-antal — skal være konfigurerbar
- Ikke allokere per-frame (cache neighbor-pairs og reference-areal)

## Must DO
- Implementér neighbor springs med cached pair-list
- Implementér shape preservation via Shoelace-areal comparison
- Brug semi-implicit Euler integration
- Substeps parameter med default 1 (backwards compatible)
- Centroid anchoring mod base_pos

## Verification
- `cargo test` består alle 4 tests
- `cargo clippy` giver 0 warnings
- Visuel test: element under kraftig interaktion holder form og vender tilbage til base position
