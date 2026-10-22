# Japan Soaring Club Flight Desk

A lightweight, dependency-free dashboard for Japan Soaring Club (WeGlide club 709). It shows monthly best-flight leaders and per-flight rankings for thermal climb rate, glide ratio, speed, and duration, filterable by season, month, region, and aircraft class.

## Run

Open index.html in a browser. If local file restrictions block API requests, serve this folder over HTTP, for example with Python's built-in server:

```powershell
py -m http.server 8000
```

Then open http://localhost:8000.

## Data and calculations

- Reads public flights from https://api.weglide.org/v1/flight for Japan Soaring Club (ID 709).
- Separates domestic flights by takeoff-airport region JP; other known region codes are grouped as overseas, and unknown regions are excluded.
- Class filtering supports All Class, WeGlide Club Class (CL), and club aircraft registrations JA2412, JA2442, and JA2444.
- The month selector filters summary metrics and both rankings without making another API request.
- CSV export includes all flights matching the selected region, month, class, and flight metric, with monthly and metric ranks plus flight duration in minutes.
- Fetches one season at a time using the Free contest, in sequential pages of 100, and caches each result in browser storage for 15 minutes.
- Monthly standings include every pilot's highest single-flight contest score for that month; the top three are highlighted on a podium, each flight links to its WeGlide detail page, and only the WeGlide primary pilot is credited.
- Average thermal climb rate, glide ratio, speed, and duration rank individual flights by their recorded values. Speed requires at least 50 km of flight distance.

No API key is embedded. Follow the WeGlide API Terms of Use and avoid substantial or systematic database extraction: https://docs.weglide.org/legal/api_terms_of_use.html
