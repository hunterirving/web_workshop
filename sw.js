const CACHE_NAME = 'web-workshop-v10';
const urlsToCache = [
  '/web_workshop/',
  '/web_workshop/index.html',
  '/web_workshop/manifest.json',
  // CodeMirror dependencies
  'https://esm.sh/@codemirror/view@6',
  'https://esm.sh/@codemirror/state@6', 
  'https://esm.sh/@codemirror/commands@6',
  'https://esm.sh/@codemirror/lang-html@6',
  'https://esm.sh/@fsegurai/codemirror-theme-github-dark',
  'https://esm.sh/@codemirror/language@6',
  'https://esm.sh/@codemirror/autocomplete@6',
  'https://esm.sh/@codemirror/search@6'
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

// Function to cache all resources using the generated manifest
async function cacheResources(cache) {
  try {
    const response = await fetch('/web_workshop/resource-manifest.json');
    if (response.ok) {
      const manifest = await response.json();
      console.log(`Caching ${manifest.images.length} images and ${manifest.resources.length} resources from manifest`);
      
      // Cache images
      for (const imagePath of manifest.images) {
        try {
          await cache.add(imagePath);
          console.log(`Cached image: ${imagePath}`);
        } catch (e) {
          console.log(`Failed to cache image ${imagePath}:`, e);
        }
      }
      
      // Cache resources
      for (const resourcePath of manifest.resources) {
        try {
          await cache.add(resourcePath);
          console.log(`Cached resource: ${resourcePath}`);
        } catch (e) {
          console.log(`Failed to cache resource ${resourcePath}:`, e);
        }
      }
    } else {
      console.log('No resource manifest found, skipping resource caching');
    }
  } catch (e) {
    console.log('Failed to load resource manifest:', e);
  }
}

// Install service worker and cache resources
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async cache => {
        // Cache core files first
        const coreFiles = urlsToCache.filter(url => !url.startsWith('https://'));
        await cache.addAll(coreFiles);
        
        // Cache external dependencies with better error handling
        const externalFiles = urlsToCache.filter(url => url.startsWith('https://'));
        for (const url of externalFiles) {
          try {
            await cache.add(url);
          } catch (error) {
            console.log(`Failed to cache ${url}:`, error);
          }
        }
        
        // Cache all resources programmatically
        await cacheResources(cache);
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