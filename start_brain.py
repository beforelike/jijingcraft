#!/usr/bin/env python3
"""
Startup entry-point for the Python Smart Brain service.
Usage:
    python start_brain.py
Or:
    python -m python_brain.main
"""
import sys
import os

# Ensure the project root is in the path
sys.path.insert(0, os.path.dirname(__file__))

from python_brain.main import serve

if __name__ == "__main__":
    serve()
