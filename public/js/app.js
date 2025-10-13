// Initialize dashboard
let dashboard;

document.addEventListener('DOMContentLoaded', () => {
    dashboard = new Dashboard();
});

window.addEventListener('beforeunload', () => {
    dashboard?.destroy();
});