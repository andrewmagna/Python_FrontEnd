# README

## Fullstack Scaffold for FastAPI and React

This repository contains a fullstack scaffold with a FastAPI backend and a React frontend.

### Backend
- **FastAPI** application built with Python 3.11.
- Endpoints to:
  - List parts by scanning `C:\assets\parts`.
  - Get part details with sections from `C:\assets\sections\<part>\section_N.png`.
  - Serve static files from `C:\assets`.
  - Store zone polygons and zone state in SQLite using SQLAlchemy.
  - OpenCV endpoint to detect polygons from `section_N_annotated.png`.

### Frontend
- React application created with Vite.
- Routes for:
  - Parts grid.
  - Part view with SVG polygon overlays and toggle calls.
  - Admin zone editor with optional auto-detect and manual polygon editing/reordering.

### Development Instructions for Windows
1. Clone the repository.
2. Set up a virtual environment for Python and install dependencies.
3. Run the FastAPI app.
4. Set up the Vite React app and run it.

### .env.example
Create a `.env` file based on `.env.example` for OPC UA endpoint and node naming configuration.