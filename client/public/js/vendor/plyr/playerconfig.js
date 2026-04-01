	const player = new Plyr('#player', {
		enabled:               true,                  									 // Completely disable Plyr. Useful for conditional UA-based initialization.
		debug:                 true,             							  		     // Display debugging information in the console.
		controls: [
			'play-large', 'play', 'progress', 'current-time',
			'mute', 'volume', 'captions', 'settings',
			'pip', 'airplay', 'fullscreen'
		],                                           									 // Controls to include in the UI.
		settings:              ['captions', 'quality', 'speed', 'loop'], 	  		     // Settings shown in settings menu.
		i18n:                  {},                   									 // Used for internationalization (i18n) of the text within the UI. See defaults.js.
//   	loadSprite:            false,                  									 // Load the SVG sprite if iconUrl is provided.
//		iconUrl:               null,                   									 // URL or path to the SVG sprite.
		iconPrefix:            'plyr',                 									 // Prefix used for icon IDs in the sprite.
		blankVideo:            'blank.mp4', 					 					     // Blank video file to cancel requests properly.
		autoplay:              false,                  									 // Autoplay the media on load.
		autopause:             true,                 								     // Only one player playing at a time.
		playsinline:           true,                  									 // Allow inline playback on iOS.
		seekTime:              10,                     									 // Seconds to skip forward/back when seeking.
		volume:                1,                                            		     // Initial volume (0 to 1).
		muted:                 false,                                        	 	     // Start playback muted.
		clickToPlay:           true,                                     		         // Clicking the container toggles play/pause.
		disableContextMenu:    true,                                    		         // Disable right context menu on video
		hideControls:          true,                                           		     // Auto-hide controls after inactivity or on fullscreen/playback.
		resetOnEnd:            false,                                          		     // Reset to beginning when playback ends.
		keyboard: {
			focused:          true,               							     		 // Keyboard shortcuts only when player is focused.
			global:           false               							     		 // Keyboard shortcuts are not global.
		},
		tooltips: {
			controls:         false,           							         		 // Show tooltips on controls.
			seek:             true                                               		 // Show tooltip on seek bar.
		},
		duration:              null,                						    		 // Custom duration override for media.
		displayDuration:       true,                						   	     	 // Show duration on metadata load (requires preload != none).
		invertTime:            true,               							   			 // Display time as countdown rather than elapsed time.
		toggleInvert:          true,                						    		 // Allow user to toggle between countdown/elapsed.
//broken listeners:             null,                  							 		 // Custom event listeners for controls.
		captions: {
			active:           false,                  							 		 // Whether captions are active by default.
			language:         'auto',                 							 		 // Default caption language or 'auto' for browser language.
			update:           false                  						    		 // Enable track list updates for dynamic sources.
		},
		fullscreen: {
			enabled:          true,                   									 // Enable fullscreen support.
			fallback:         true,                   									 // Fallback to pseudo-fullscreen if native not available.
			iosNative:        false,                 									 // Use native iOS fullscreen (no custom UI). No effect on iPadOS.
			container:        null                  								     // Specify fullscreen container (ancestor selector).
		},
		ratio:                 null,                								     // Force specific aspect ratio (e.g., '16:9').
		storage: {
			enabled:          true,                 						  		     // Enable saving player state in localStorage.
			key:              'plyr'                  			   						 // Key name for storage.
		},
		speed: {
			selected: 1,
			options: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
		},
		quality: {
			default:          1080,                    									 // Default quality if available in source.
			options:          [4320, 2880, 2160, 1440, 1080, 720, 576, 480, 360, 240]    // Filter options for available qualities.
		},
		loop: {
			active:           false                   									 // Loop playback when enabled.
		},
		ads: {
			enabled:          false,                  // Enable ad support.
			publisherId:      '',                     // vi.ai publisher ID.
			tagUrl:           ''                      // Custom VAST tag URL (if not using Vi).
		},
		urls:                 {},                     // Override internal API URLs.
		vimeo: {
			byline:           false,
			portrait:         false,
			title:            false,
			speed:            true,
			transparent:      false                   // Vimeo embed config options.
		},
		youtube: {
			noCookie:         true,                   // Use youtube-nocookie.com for GDPR compliance.
			rel:              0,                      // Don’t show related videos.
			showinfo:         0,                      // Deprecated by YouTube.
			iv_load_policy:   3,                      // Hide annotations.
			modestbranding:   1                       // Minimal YouTube branding.
		},
		previewThumbnails: {
			enabled:          false,                  // Enable preview thumbnails.
			src:              ''                      // URL or array of VTT files with thumbnail data.
		},
		mediaMetadata: {
			title:            '',                     // Used for Media Session API.
			artist:           '',
			album:            '',
			artwork:          []
		},
		markers: {
			enabled:          false,                  // Enable markers in the timeline.
			points:           []                      // Array of markers: { time, label }.
		}
	});