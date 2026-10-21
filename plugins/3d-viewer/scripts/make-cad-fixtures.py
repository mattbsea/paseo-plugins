"""Writes the CAD test fixtures:

- bracket.igs, bracket.brep: a 40 x 20 x 10 mm block with a 6 mm through-hole
- test_adapter.step, test_adapter.stl: a stepped tube with a slot, 53 x 53 x 73 mm
 Needs OpenCascade's Python bindings (pip install cadquery-ocp); the
outputs are committed, so this only runs when the fixtures change.

    python3 scripts/make-cad-fixtures.py
"""

from pathlib import Path

from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.BRepAlgoAPI import BRepAlgoAPI_Fuse
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_AsIs, STEPControl_Writer
from OCP.StlAPI import StlAPI_Writer
from OCP.BRepTools import BRepTools
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt
from OCP.IGESControl import IGESControl_Controller, IGESControl_Writer

fixtures = Path(__file__).resolve().parent.parent / "test" / "fixtures"

block = BRepPrimAPI_MakeBox(40.0, 20.0, 10.0).Shape()
hole = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(20.0, 10.0, -1.0), gp_Dir(0, 0, 1)), 3.0, 12.0).Shape()
bracket = BRepAlgoAPI_Cut(block, hole).Shape()

BRepTools.Write_s(bracket, str(fixtures / "bracket.brep"))

IGESControl_Controller.Init_s()
writer = IGESControl_Writer("MM", 1)  # mode 1: B-rep solids (type 186)
writer.AddShape(bracket)
writer.ComputeModel()
if not writer.Write(str(fixtures / "bracket.igs")):
    raise SystemExit("IGES export failed")
# Stepped tube: 33 mm of 48 mm OD below 40 mm of 53 mm OD, 2 mm walls, a slot in the
# lower section. Envelope 53 x 53 x 73 mm.
z = gp_Dir(0, 0, 1)
lower = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 0), z), 24.0, 33.0).Shape()
upper = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 33.0), z), 26.5, 40.0).Shape()
solid = BRepAlgoAPI_Fuse(lower, upper).Shape()
bore_lower = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, -1.0), z), 22.0, 35.0).Shape()
bore_upper = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 33.0), z), 24.5, 41.0).Shape()
slot = BRepPrimAPI_MakeBox(gp_Pnt(-1.0, -30.0, -1.0), 2.0, 10.0, 16.0).Shape()
adapter = BRepAlgoAPI_Cut(BRepAlgoAPI_Cut(BRepAlgoAPI_Cut(solid, bore_lower).Shape(), bore_upper).Shape(), slot).Shape()

step = STEPControl_Writer()
step.Transfer(adapter, STEPControl_AsIs)
if step.Write(str(fixtures / "test_adapter.step")) != IFSelect_RetDone:
    raise SystemExit("STEP export failed")
BRepMesh_IncrementalMesh(adapter, 0.05, False, 0.3, True)
stl = StlAPI_Writer()
stl.ASCIIMode = False
if not stl.Write(adapter, str(fixtures / "test_adapter.stl")):
    raise SystemExit("STL export failed")
print("wrote bracket.brep, bracket.igs, test_adapter.step and test_adapter.stl")
