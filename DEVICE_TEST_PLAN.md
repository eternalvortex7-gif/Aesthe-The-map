# Real-device test plan

The automatic tests use a desktop browser with a software graphics card and fake network answers. These things need a real phone.
Test on the **live HTTPS site**, once on an iPhone (Safari) and once on an Android phone (Chrome). Note the phone model and OS version.
Write PASS or FAIL next to each line and what you saw if it failed.

## First visit
1. Open the site. The map appears, the privacy notice shows at the bottom, and **no location prompt appears by itself**.
2. OpenStreetMap and OpenFreeMap credits are readable at the bottom of the map.
3. Tap **Got it** on the notice. Reload: the notice stays away.

## Search
4. Type "cafe" slowly. Suggestions appear within about a second. Tap one: the map flies there, the pin tip sits on the place.
5. Type a full place name and press the keyboard's Go/Enter key. The place opens.
6. Search for a misspelled name ("starbuks"). A sensible match is offered.
7. Search while in Airplane mode: a calm message, no blank screen.

## Map
8. Pinch to zoom, drag, rotate with two fingers. Smooth, no page scrolling behind the map.
9. Tap a named shop or cafe on the map: it opens.
10. Panel: minimise it, expand it, use the fullscreen button. The credits stay visible each time.
11. Rotate the phone to landscape and back. Nothing is cut off, every round button is reachable.

## Location
12. Tap the location button. The system permission prompt appears **now** (not before). Allow: a blue dot appears.
13. Deny instead (try once in each phone): a clear message, and the app keeps working.

## Photos
14. Open a well-known landmark. Photos hang above the pin, with author and licence under the photo.
15. Swipe the carousel left and right. Tap a photo: it opens large, with credits. Close it.
16. Tap **Add photo**, take or choose one: it appears first in the frame. Reload: it is still there.

## Directions
17. Open a place, tap Directions (Drive, then Walk). A route draws and shows distance and time.

## Offline and install
18. Tap **Save area offline** on Wi-Fi. Wait for "Saved". Turn on Airplane mode, reload: the map of that area still shows, and an "Offline" banner appears.
19. Install to the home screen (Safari: Share, Add to Home Screen. Chrome: menu, Install app). Open from the icon: it opens full screen with the aesthe icon.
20. About, **Clear my data**, tap twice: the notice returns, your photos and saved places are gone.

## Performance feel
21. On mobile data, from a cold start to a usable map: under about 4 seconds is good, over 8 seconds is a problem to report.
22. Pan around for a minute: no growing lag, the phone does not get hot.
23. Zoom in on a busy street (zoom 16-17) and tilt the map (3D button) with Motion on: the little 3D cars, buses, motorbikes and walkers stay smooth (about 25 frames a second or more) and the phone does not heat up. If they stutter on an older phone, tell me: the number of figures can be lowered.
24. Tilted, look from the side: the figures stand up like the buildings, keep to the side of the street set by `drivingSide`, and queue up behind a road block.
25. Zoom out slowly: the figures grow a little (so they stay visible) but never become towers; trains in a tunnel look faint.
26. Satellite with a key set (`esriKey` or `maptilerKey`): turn Satellite on and zoom in to a street you know. Roofs, roads and trees should stay crisp, not blur, down to the closest zoom, and the provider's credit should show. Without a key, the pictures are the free 10 m set: they soften once you zoom past about 14, and a one-time "low detail" note appears.
27. Satellite with a wrong key (or offline for that provider): you should see a short note and the free pictures, not a blank or grey map.
28. Zoom the map out to a whole region, then tap **Cafés**, **Food**, **Hotels**...: the map should settle zoomed in on the middle of the view (street level), with the nearest places marked. Tap the same tab again, then another tab: the map stays in the same area, it must never fly away or zoom out to a far-off place.
