const CACHE_NAME = 'web-workshop-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Function to discover and cache all files in directories
async function cacheDirectoryFiles(cache, directories) {
  for (const dir of directories) {
    try {
      // Try to fetch directory listing
      const response = await fetch(dir);
      if (response.ok) {
        const html = await response.text();
        // Extract file links from directory listing
        const links = html.match(/href="([^"]*\.(png|jpg|jpeg|gif|svg|webp|html|css|js|json|txt|md))"/gi);
        if (links) {
          const files = links.map(link => {
            const match = link.match(/href="([^"]*)"/);
            return match ? dir + match[1] : null;
          }).filter(Boolean);
          
          // Cache each file
          for (const file of files) {
            try {
              await cache.add(file);
            } catch (e) {
              console.log(`Failed to cache ${file}:`, e);
            }
          }
        }
      }
    } catch (e) {
      console.log(`Failed to cache directory ${dir}:`, e);
    }
  }
}

// Install service worker and cache resources
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async cache => {
        // Cache core files
        await cache.addAll(urlsToCache);
        // Cache directory files
        await cacheDirectoryFiles(cache, ['/images/', '/pages/']);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate service worker and clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch strategy: Network first, then cache (for updates when online)
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // If we got a response, add it to the cache
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME)
            .then(cache => cache.put(event.request, responseClone));
        }
        return response;
      })
      .catch(() => {
        // Network failed, try cache
        return caches.match(event.request)
          .then(response => {
            if (response) {
              return response;
            }
            // If not in cache and it's a navigation request, serve index.html
            if (event.request.mode === 'navigate') {
              return caches.match('/index.html');
            }
            throw new Error('No cached version available');
          });
      })
  );
});