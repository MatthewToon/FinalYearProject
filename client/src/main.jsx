  ///////////////
 //  Imports  //
///////////////

// React core library - required to create and render UI components
import React from "react";

// ReactDOM client renderer - responsible for mounting the React application to the browser DOM
import ReactDOM from "react-dom/client";

// Root application component - App.jsx will contain the main UI logic for the client
import App from "./App.jsx";

// Global stylesheet - optional but commonly included for base styles
import "./index.css";

  //////////////////////
 //  Initialisation  //
//////////////////////

// Locate the root HTML element where the React application will be mounted
// This element exists in index.html as: <div id="root"></div>
const rootElement = document.getElementById("root");

// Create a React root and render the application
// React.StrictMode enables additional development checks
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);