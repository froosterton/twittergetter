const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const axios = require('axios');
const fs = require('fs');

// --- CONFIGURATION ---
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://discord.com/api/webhooks/1404188843451744377/egOgRSomhoOCJvjL4ssBVHUnpCcvWYBZsBJ8pgEJNEsFScezJQy6w0NS3JYlSpSc9Yz3';
const MAX_VALUE = parseInt(process.env.MAX_VALUE) || 7000000;
const MAX_TRADE_ADS = parseInt(process.env.MAX_TRADE_ADS) || 1000;
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const ITEM_IDS = process.env.ITEM_IDS || '123456,789012'; // Default item IDs to scrape

let driver;
let totalUsersProcessed = 0;
let totalConnectionsFound = 0;

// --- SELENIUM SETUP ---
async function initializeWebDriver() {
    try {
        console.log('🔧 Initializing Selenium WebDriver...');
        const options = new chrome.Options();
        options.addArguments(
            '--headless',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor'
        );
        
        driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
        console.log('✅ Selenium WebDriver initialized successfully');
        return true;
    } catch (error) {
        console.error('❌ WebDriver initialization error:', error.message);
        return false;
    }
}

// --- RATE LIMIT DETECTION ---
async function isRolimonsRateLimited(driver) {
    try {
        await driver.sleep(2000);
        const alerts = await driver.findElements(By.css('div.alert.alert-danger.text-center.mt-4.rounded-0'));
        for (const alert of alerts) {
            const text = await alert.getText();
            if (text.includes("Couldn't scan player's assets")) {
                return true;
            }
        }
        return false;
    } catch {
        return false;
    }
}

// --- SCRAPE ROLIMONS ITEM ---
async function scrapeRolimonsItem(itemId) {
    try {
        const url = `https://www.rolimons.com/item/${itemId}`;
        console.log(`🔍 Navigating to ${url}`);
        await driver.get(url);
        await driver.sleep(5000);

        // Click "All Copies" tab
        try {
            console.log('📋 Clicking "All Copies" tab...');
            const allCopiesTab = await driver.findElement(By.css('a[href="#all_copies_table_container"]'));
            const className = await allCopiesTab.getAttribute('class');
            if (!className.includes('active')) {
                await allCopiesTab.click();
                await driver.sleep(2000);
            }
        } catch (e) {
            console.log('⚠️ Could not find/click All Copies tab');
        }

        // Check for rate limit
        if (await isRolimonsRateLimited(driver)) {
            console.log('🚫 Rate limited! Waiting 30 seconds...');
            await driver.sleep(30000);
        }

        // Go to last page
        console.log('📄 Finding total pages and going to last page...');
        let totalPages = 1;
        try {
            const paginationButtons = await driver.findElements(By.css('a.page-link[data-dt-idx]'));
            if (paginationButtons.length > 0) {
                for (const button of paginationButtons) {
                    try {
                        const text = await button.getText();
                        const pageNum = parseInt(text);
                        if (!isNaN(pageNum) && pageNum > totalPages) {
                            totalPages = pageNum;
                        }
                    } catch (e) {}
                }
                
                if (totalPages > 1) {
                    console.log(`📄 Found ${totalPages} total pages, going to last page...`);
                    try {
                        // Scroll to top first
                        await driver.executeScript('window.scrollTo(0, 0);');
                        await driver.sleep(1000);
                        
                        // Try to find and click the last page button
                        let lastPageButton = null;
                        
                        // Method 1: Try XPath
                        try {
                            lastPageButton = await driver.findElement(By.xpath(`//a[@class='page-link' and @data-dt-idx and text()='${totalPages}']`));
                        } catch (e) {}
                        
                        // Method 2: Try CSS selector
                        if (!lastPageButton) {
                            try {
                                const buttons = await driver.findElements(By.css('a.page-link'));
                                for (const button of buttons) {
                                    const text = await button.getText();
                                    if (text === totalPages.toString()) {
                                        lastPageButton = button;
                                        break;
                                    }
                                }
                            } catch (e) {}
                        }
                        
                        if (lastPageButton) {
                            // Try JavaScript click if regular click fails
                            try {
                                await lastPageButton.click();
                            } catch (clickError) {
                                console.log('Regular click failed, trying JavaScript click...');
                                await driver.executeScript('arguments[0].click();', lastPageButton);
                            }
                            await driver.sleep(5000);
                            console.log(`✅ Now on page ${totalPages} (last page)`);
                        } else {
                            console.log('⚠️ Could not find last page button, starting from current page');
                        }
                    } catch (error) {
                        console.log('⚠️ Error navigating to last page:', error.message);
                        console.log('Starting from current page...');
                    }
                }
            }
        } catch (e) {
            console.log('⚠️ Could not determine total pages, starting from current page');
        }

        let currentPage = totalPages;

        // Start scraping from last page and go backwards
        while (currentPage >= 1) {
            console.log(`\n📄 Scraping page ${currentPage}...`);
            
            // Wait for table to load
            await driver.sleep(3000);

            // Find user rows
            let rows = [];
            try {
                rows = await driver.findElements(By.css('#all_copies_table tbody tr'));
                if (rows.length === 0) {
                    rows = await driver.findElements(By.css('table tbody tr'));
                }
                console.log(`👥 Found ${rows.length} rows on this page`);
            } catch (e) {
                console.log('❌ Could not find table rows');
            }

            if (rows.length === 0) {
                console.log('⚠️ No rows found on this page, moving to previous page...');
            } else {
                // Process each row
                for (let i = 0; i < rows.length; i++) {
                    try {
                        // Re-find the row to avoid stale element issues
                        const currentRows = await driver.findElements(By.css('#all_copies_table tbody tr'));
                        if (i >= currentRows.length) break;
                        
                        const row = currentRows[i];
                        const tds = await row.findElements(By.css('td'));
                        
                        // Find user link
                        let userLink = null;
                        try {
                            userLink = await row.findElement(By.css('a[href*="/player/"]'));
                        } catch (e) {
                            try {
                                userLink = await row.findElement(By.css('a[href*="rolimons.com/player/"]'));
                            } catch (e2) {
                                continue;
                            }
                        }
                        
                        const userUrl = await userLink.getAttribute('href');
                        const username = await userLink.getText();
                        
                                                 // Get Last Online from the table (for logging only)
                         let lastOnlineText = '';
                         if (tds.length > 3) {
                             try {
                                 const span = await tds[3].findElement(By.css('span'));
                                 lastOnlineText = (await span.getText()).trim();
                             } catch {
                                 lastOnlineText = (await tds[3].getText()).trim();
                             }
                         }

                        // Get Rolimons data
                        console.log(`(Getting data for "${username}" from ${userUrl})`);
                        const rolimonsData = await scrapeRolimonsUserProfile(userUrl);
                        if (!rolimonsData) {
                            console.log(`(Failed to get data for "${username}", skipping)`);
                            continue;
                        }
                        console.log(`(Got data for "${username}" - Value: ${rolimonsData.value.toLocaleString()}, Trade Ads: ${rolimonsData.tradeAds})`);
                        
                        if (rolimonsData.value > MAX_VALUE) {
                            console.log(`(Skipping "${username}" - Value too high: ${rolimonsData.value.toLocaleString()})`);
                            continue;
                        }
                        
                        if (rolimonsData.tradeAds >= MAX_TRADE_ADS) {
                            console.log(`(Skipping "${username}" - Trade ads too high: ${rolimonsData.tradeAds})`);
                            continue;
                        }

                        // Only reach here if user passes filters
                        totalUsersProcessed++;
                        
                        console.log(`(Checking "${username}")`);
                        
                        // Check Roblox profile for social connections
                        const socialData = await checkRobloxProfile(rolimonsData.userId || username);
                        
                        if (socialData.connectionFound) {
                            console.log(`(Has connection! "${socialData.connectionType}")`);
                            totalConnectionsFound++;
                            
                            // Send to Discord webhook
                            await sendToDiscord({
                                username: username,
                                value: rolimonsData.value,
                                connectionType: socialData.connectionType,
                                connectionData: socialData.connectionData
                            });
                        } else {
                            console.log(`(No Contact found, Skipping)`);
                        }

                        // Wait between users
                        await new Promise(resolve => setTimeout(resolve, 8000));
                        
                    } catch (error) {
                        console.log(`(Error processing user, continuing...)`);
                        continue;
                    }
                }
            }

            // Try to go to previous page
            if (currentPage > 1) {
                try {
                    console.log('⬅️ Attempting to go to previous page...');
                    
                    // Scroll to top to avoid element interception
                    await driver.executeScript('window.scrollTo(0, 0);');
                    await driver.sleep(1000);
                    
                    // Try multiple approaches to find and click the previous button
                    let prevButton = null;
                    
                    // Method 1: Try the standard previous button
                    try {
                        const prevButtons = await driver.findElements(By.css('li.paginate_button.page-item.previous:not(.disabled) a.page-link'));
                        if (prevButtons.length > 0) {
                            prevButton = prevButtons[0];
                        }
                    } catch (e) {}
                    
                    // Method 2: Try finding by text content
                    if (!prevButton) {
                        try {
                            const allButtons = await driver.findElements(By.css('a.page-link'));
                            for (const button of allButtons) {
                                const text = await button.getText();
                                if (text === 'Previous' || text === '‹') {
                                    prevButton = button;
                                    break;
                                }
                            }
                        } catch (e) {}
                    }
                    
                    // Method 3: Try finding by aria-label
                    if (!prevButton) {
                        try {
                            const prevButtons = await driver.findElements(By.css('a.page-link[aria-label="Previous"]'));
                            if (prevButtons.length > 0) {
                                prevButton = prevButtons[0];
                            }
                        } catch (e) {}
                    }
                    
                    if (prevButton) {
                        // Try to click using JavaScript if regular click fails
                        try {
                            await prevButton.click();
                        } catch (clickError) {
                            console.log('Regular click failed, trying JavaScript click...');
                            await driver.executeScript('arguments[0].click();', prevButton);
                        }
                        
                        await driver.sleep(3000);
                        currentPage--;
                        console.log(`✅ Moved to page ${currentPage}`);
                    } else {
                        console.log('🔚 No previous button found, reached first page');
                        break;
                    }
                } catch (error) {
                    console.log('❌ Error navigating to previous page:', error.message);
                    console.log('🔚 Stopping pagination');
                    break;
                }
            } else {
                console.log('🔚 Reached first page, scraping complete!');
                break;
            }
        }

        console.log(`\nItem ${itemId} complete!`);
        console.log(`Users processed: ${totalUsersProcessed}`);
        console.log(`Connections found: ${totalConnectionsFound}`);

    } catch (error) {
        console.error('❌ Error in scrapeRolimonsItem:', error.message);
    }
}

// --- ROLIMONS USER PROFILE SCRAPING ---
async function scrapeRolimonsUserProfile(profileUrl) {
    const tempDriver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(
            new chrome.Options()
                .addArguments('--headless')
                .addArguments('--disable-gpu')
                .addArguments('--window-size=1920,1080')
                .addArguments('--no-sandbox')
                .addArguments('--disable-dev-shm-usage')
        )
        .build();

    try {
        console.log(`(Scraping profile: ${profileUrl})`);
        await tempDriver.get(profileUrl);
        await tempDriver.sleep(2000);

        const getText = async (selector) => {
            try {
                const element = await tempDriver.findElement(By.css(selector));
                return await element.getText();
            } catch {
                return '';
            }
        };

        // Get username from page title
        const username = await getText('h1.page_title.mb-0');
        
        // Get user ID from Rolimons page URL
        let userId = '';
        try {
            // Extract user ID from the original URL
            const urlMatch = profileUrl.match(/\/player\/(\d+)/);
            if (urlMatch) {
                userId = urlMatch[1];
            }
        } catch (e) {
            // Could not extract user ID
        }
        
        // Get value - try multiple selectors
        let valueText = await getText('#player_value');
        if (!valueText) {
            // Try alternative selector
            valueText = await getText('h5.card-title.mb-1.text-light.text-truncate.stat-data#player_value');
        }

        let value = 0;
        if (valueText) {
            value = parseInt(valueText.replace(/,/g, ''));
        }
        
        // Get trade ads count - try multiple selectors
        let tradeAds = 0;
        const tradeAdsSelectors = [
            'a[href*="/tradeads/"]',
            'a[href*="tradeads"]',
            '.trade-ads-count',
            '[data-testid="trade-ads"]'
        ];
        
        for (const selector of tradeAdsSelectors) {
            try {
                const tradeAdsElement = await tempDriver.findElement(By.css(selector));
                const tradeAdsText = await tradeAdsElement.getText();
                const match = tradeAdsText.match(/(\d+)/);
                if (match) {
                    tradeAds = parseInt(match[1]);
                    break;
                }
            } catch (e) {
                continue;
            }
        }

        await tempDriver.quit();

        return {
            username: username.trim(),
            userId: userId,
            value: value,
            tradeAds: tradeAds
        };

    } catch (error) {
        console.log(`(Error scraping profile: ${error.message})`);
        await tempDriver.quit();
        return null;
    }
}

// --- CHECK ROBOX PROFILE FOR SOCIAL CONNECTIONS ---
async function checkRobloxProfile(username) {
    // Add timeout to prevent hanging
    let timeoutReached = false;
    const timeout = setTimeout(() => {
        console.log(`(Timeout reached for ${username}, returning no connection)`);
        timeoutReached = true;
    }, 15000); // 15 second timeout
    const tempDriver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(
            new chrome.Options()
                .addArguments('--headless')
                .addArguments('--disable-gpu')
                .addArguments('--window-size=1920,1080')
                .addArguments('--no-sandbox')
                .addArguments('--disable-dev-shm-usage')
                .addArguments('--disable-blink-features=AutomationControlled')
                .addArguments('--disable-web-security')
                .addArguments('--allow-running-insecure-content')
                .addArguments('--timeout=15000') // 15 second timeout
                .addArguments('--page-load-timeout=15000') // 15 second page load timeout
        )
        .build();

    // Add authentication token to browser (if provided)
    if (AUTH_TOKEN) {
        await tempDriver.get('https://www.roblox.com');
        await tempDriver.manage().addCookie({
            name: '.ROBLOSECURITY',
            value: AUTH_TOKEN,
            domain: '.roblox.com',
            path: '/'
        });
    }

    try {
        // Check timeout before starting
        if (timeoutReached) {
            clearTimeout(timeout);
            await tempDriver.quit();
            return { connectionFound: false, connectionType: '', connectionData: '' };
        }
        
        // Use user ID for Roblox profile URL (more reliable than username)
        const robloxUrl = `https://www.roblox.com/users/${username}/profile`;
        console.log(`(Checking Roblox profile: ${robloxUrl})`);
        await tempDriver.get(robloxUrl);
        await tempDriver.sleep(5000);
        
        // Check timeout
        if (timeoutReached) {
            clearTimeout(timeout);
            await tempDriver.quit();
            return { connectionFound: false, connectionType: '', connectionData: '' };
        }
        
        // Wait for page to fully load
        await tempDriver.sleep(2000);
        
        // Check timeout
        if (timeoutReached) {
            clearTimeout(timeout);
            await tempDriver.quit();
            return { connectionFound: false, connectionType: '', connectionData: '' };
        }
        
        // Wait for Angular components to load
        await tempDriver.sleep(3000);
        
        // Try to wait for social links to appear
        try {
            await tempDriver.wait(until.elementLocated(By.css('social-link-icon')), 10000);
        } catch (e) {
            // Continue if not found
        }
        
        // Scroll down to load more content
        await tempDriver.executeScript('window.scrollTo(0, document.body.scrollHeight);');
        await tempDriver.sleep(2000);
        await tempDriver.executeScript('window.scrollTo(0, 0);');
        await tempDriver.sleep(1000);

        // Check for social media connections
        let connectionFound = false;
        let connectionType = '';
        let connectionData = '';

        // Check timeout before social link detection
        if (timeoutReached) {
            clearTimeout(timeout);
            await tempDriver.quit();
            return { connectionFound: false, connectionType: '', connectionData: '' };
        }
        
        try {
            console.log(`(Looking for social connections...)`);
            // Find Angular social link components directly
            const socialComponents = await tempDriver.findElements(By.css('social-link-icon'));
            console.log(`(Found ${socialComponents.length} social components)`);
            
            let socialLinks = [];
            
            // Extract links from Angular components
            if (socialComponents.length > 0) {
                for (const component of socialComponents) {
                    try {
                        const links = await component.findElements(By.css('a'));
                        for (const link of links) {
                            const href = await link.getAttribute('href');
                            const ngHref = await link.getAttribute('ng-href');
                            const title = await link.getAttribute('title');
                            const ariaLabel = await link.getAttribute('aria-label');
                            const actualHref = href || ngHref;
                            
                            // Only process and log if it's a social media link
                            if (actualHref && !actualHref.includes('roblox.com') && !actualHref.includes('create.roblox.com')) {
                                // Check if it's actually a social media link
                                if (actualHref.includes('x.com') || actualHref.includes('twitter.com') || 
                                    actualHref.includes('facebook.com') || actualHref.includes('instagram.com') ||
                                    actualHref.includes('youtube.com') || actualHref.includes('twitch.tv') ||
                                    actualHref.includes('guilded.gg') || title === 'Twitter' || title === 'X' ||
                                    title === 'Facebook' || title === 'Instagram' || title === 'YouTube' ||
                                    title === 'Twitch' || title === 'Guilded' ||
                                    ariaLabel?.includes('Twitter') || ariaLabel?.includes('X') ||
                                    ariaLabel?.includes('Facebook') || ariaLabel?.includes('Instagram') ||
                                    ariaLabel?.includes('YouTube') || ariaLabel?.includes('Twitch') ||
                                    ariaLabel?.includes('Guilded')) {
                                    
                                    socialLinks.push({link, href: actualHref, title, ariaLabel});
                                }
                            }
                        }
                    } catch (e) {
                        continue;
                    }
                }
            }
            
            // Process social links
            for (const {link, href, title, ariaLabel} of socialLinks) {
                try {
                    // Determine connection type from URL or attributes
                    if (href.includes('x.com') || href.includes('twitter.com') || title === 'Twitter' || title === 'X' || ariaLabel?.includes('Twitter') || ariaLabel?.includes('X')) {
                        connectionFound = true;
                        connectionType = 'Twitter';
                        connectionData = href;
                        break;
                    } else if (href.includes('facebook.com') || title === 'Facebook' || ariaLabel?.includes('Facebook')) {
                        connectionFound = true;
                        connectionType = 'Facebook';
                        connectionData = href;
                        break;
                    } else if (href.includes('instagram.com') || title === 'Instagram' || ariaLabel?.includes('Instagram')) {
                        connectionFound = true;
                        connectionType = 'Instagram';
                        connectionData = href;
                        break;
                    } else if (href.includes('youtube.com') || title === 'YouTube' || ariaLabel?.includes('YouTube')) {
                        connectionFound = true;
                        connectionType = 'YouTube';
                        connectionData = href;
                        break;
                    } else if (href.includes('twitch.tv') || title === 'Twitch' || ariaLabel?.includes('Twitch')) {
                        connectionFound = true;
                        connectionType = 'Twitch';
                        connectionData = href;
                        break;
                    } else if (href.includes('guilded.gg') || title === 'Guilded' || ariaLabel?.includes('Guilded')) {
                        connectionFound = true;
                        connectionType = 'Guilded';
                        connectionData = href;
                        break;
                    }
                } catch (e) {
                    continue;
                }
            }
        } catch (e) {
            // Error checking social links, continue
        }

        clearTimeout(timeout);
        console.log(`(Connection check complete - Found: ${connectionFound}, Type: ${connectionType})`);
        await tempDriver.quit();

        return {
            connectionFound: connectionFound,
            connectionType: connectionType,
            connectionData: connectionData
        };

    } catch (error) {
        clearTimeout(timeout);
        console.log(`(Error checking Roblox profile: ${error.message})`);
        try {
            await tempDriver.quit();
        } catch (quitError) {
            console.log(`(Error quitting driver: ${quitError.message})`);
        }
        return {
            connectionFound: false,
            connectionType: '',
            connectionData: ''
        };
    }
}

// --- SEND TO DISCORD WEBHOOK ---
async function sendToDiscord(data) {
    try {
        const embed = {
            title: '🔍 Rolimons Contacts Found',
            color: 0x00AE86,
            fields: [
                { name: '🎮 Roblox Username', value: data.username, inline: true },
                { name: '💰 Rolimons Value', value: `R$ ${data.value.toLocaleString()}`, inline: true }
            ],
            timestamp: new Date().toISOString()
        };

        // Add connection data field
        if (data.connectionType === 'Instagram' || data.connectionType === 'Twitter' || data.connectionType === 'Facebook' || data.connectionType === 'TikTok' || data.connectionType === 'YouTube' || data.connectionType === 'Snapchat' || data.connectionType === 'Discord' || data.connectionType === 'Telegram' || data.connectionType === 'Twitch' || data.connectionType === 'Guilded') {
            embed.fields.push({ name: '📝 Contact Info', value: data.connectionData, inline: false });
        } else {
            embed.fields.push({ name: '🔗 Connection Link', value: data.connectionData, inline: false });
        }

        await axios.post(WEBHOOK_URL, {
            embeds: [embed]
        });


    } catch (error) {
        console.error('❌ Error sending to Discord:', error.message);
    }
}

// --- MAIN ENTRY POINT ---
async function main() {
    // Check if we're in a non-interactive environment
    if (!process.stdin.isTTY) {
        console.log('🔧 Running in non-interactive mode (cloud environment)');
    }
    
    console.log('🚀 Enhanced Rolimons Social Scraper Starting...');
    console.log(`⚙️ Filter Settings: Max Value: ${MAX_VALUE.toLocaleString()}, Max Trade Ads: ${MAX_TRADE_ADS}`);
    
    if (!await initializeWebDriver()) {
        console.error('❌ Failed to initialize WebDriver');
        return;
    }

    // Use environment variable for item IDs instead of readline
    const itemIds = ITEM_IDS.split(',').map(id => id.trim()).filter(id => id);
    console.log(`\n📋 Queue created with ${itemIds.length} items: ${itemIds.join(', ')}`);
    
    for (let i = 0; i < itemIds.length; i++) {
        const itemId = itemIds[i];
        console.log(`\n🔄 Processing item ${i + 1}/${itemIds.length}: ${itemId}`);
        await scrapeRolimonsItem(itemId);
        
        if (i < itemIds.length - 1) {
            console.log(`\n⏳ Waiting 10 seconds before next item...`);
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
    }
    
    console.log(`\n🎉 All items completed!`);
    console.log(`📊 Total users processed: ${totalUsersProcessed}`);
    console.log(`🔗 Total connections found: ${totalConnectionsFound}`);
    
    if (driver) {
        await driver.quit();
    }
}

main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});