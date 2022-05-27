import { PluginMeta, PluginEvent, CacheExtension } from '@posthog/plugin-scaffold'
import type { RequestInfo, RequestInit, Response } from 'node-fetch'
import { createBuffer } from '@posthog/plugin-contrib'
import { RetryError } from '@posthog/plugin-scaffold'

// fetch only declared, as it's provided as a plugin VM global
declare function fetch(url: RequestInfo, init?: RequestInit): Promise<Response>
//Specify metrics : 'total_requests' => sum of all http requests (events), 'errors' : sum of error responses (API). 
export const metrics = {
    'total_requests': 'sum',
    'errors': 'sum'
}

//PluginMeta contains the object cache, and can also include global, attachments, and config.
interface SendEventsPluginMeta extends PluginMeta {
    
    //Cache: to store values that persist across special function calls. 
    //The values are stored in Redis, an in-memory store.
    cache: CacheExtension,
    
    //gives access to the app config values as described in 'plugin.json' 
    //and configured via the PostHog interface.
    config: {
        eventsToInclude: string
    },
    
    //global object is used for sharing functionality between setupPlugin 
    //and the rest of the special functions/
    global: {
        eventsToInclude: Set<string>
        buffer: ReturnType<typeof createBuffer>
    }
}

//verifyConfig function is used to verify that the included events are inserted, otherwise it will throw an error.
function verifyConfig({ config }: SendEventsPluginMeta) {
    if (!config.eventsToInclude) {
        throw new Error('No events to include!')
    }
}


async function sendEventToGorse(event: PluginEvent, meta: SendEventsPluginMeta) {

    const { config, metrics } = meta

    //split included events by ','
    const types = (config.eventsToInclude).split(',')

    //Condition: if the recieved event name is not like the included one, 
    if (types.includes(event.event)) {

        //increment the number of requests
        metrics.total_requests.increment(1)
        
        //fetch
        const response = await fetch(
            `http://51.89.15.39:8087/api/feedback`,
            {
                headers: {
                    'accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                        'Comment': '',
                        'FeedbackType' : event.event,
                        'ItemId' : event.properties?.item_id,
                        'Timestamp' : event.properties?.timestamp,
                        'UserId' :  event.properties?.user_id
                })

            },
            'PUT'
        )
        
        //Condition: throws an error if the response status is not 'ok'.
        if (!statusOk(response)) {
            
            //increment the number of errors.
            metrics.errors.increment(1)
            throw new Error(`Not a 200 response. Response: ${response.status} (${response})`)
            
        } else {
            
            console.log(`success`)
            
        }
        
    } else {
        
        return
        
    }
}
    
//setupPlugin function is used to dynamically set up configuration.  
//It takes only an object of type PluginMeta as a parameter and does not return anything.
export async function setupPlugin(meta: SendEventsPluginMeta) {  
    verifyConfig(meta)
    const { global } = meta
    global.buffer = createBuffer({
        limit: 5 * 1024 * 1024, // 1 MB
        timeoutSeconds: 1,
        onFlush: async (events) => {
            for (const event of events) {
                
               var data=     JSON.stringify({ 
                                    'FeedbackType' : event.event,
                                    'UserId' :  event.distinct_id,
                                    'ItemId' : event.properties?.item_id,
                                    'Timestamp' : event.properties?.timestamp,
                                    'Comment': ''
                                })
                
                console.log(data)
                console.log(event.event)
                console.log(event.properties?.item_id) 
                console.log(event.timestamp) 
                console.log(event.distinct_id)
                
                /////////////////////////////////////
                //////////fetchWithRetry/////////////
                const response = await fetchWithRetry(
                    'http://51.89.15.39:8087/api/feedback',
                    {
                        headers: {
                            'accept': 'application/json',
                            'Content-Type': 'application/json'
                        },
                        body: [data]
                    },
                    'PUT'
                )
                console.log(response.status)
                console.log(response.statusText)
                console.log(response.url)
                /////////////////////////////////////
                /////////////////////////////////////
                /*const response = await fetch(
                    'http://51.89.15.39:8087/api/feedback',
                    {
                        method: 'POST',
                        headers: {
                            'accept': 'application/json',
                            'Content-Type': 'application/json'
                        },
                        body: [data],
                        
                    }
                ).then(function(response) {
                      console.log(response.status)     //=> number 100–599
                      console.log(response.statusText) //=> String
                      console.log(response.url)        //=> String
                }, function(error) {
                      console.log(error.message) //=> String
                })*/
                //console.log(response.status)
                //const content = await response.json()
                //console.log(content)
                ////////////////////////////////////////
                //await sendEventToGorse(event, meta)
            }
        },
    })
}

//onEvent function takes an event and an object of type PluginMeta as parameters to read an event but not to modify it.
export async function onEvent(event: PluginEvent, { global }: SendEventsPluginMeta) {
    const eventSize = JSON.stringify(event).length
    global.buffer.add(event, eventSize)
}

//teardownPlugin is ran when a app VM is destroyed, It can be used to flush/complete any operations that may still be pending.
export function teardownPlugin({ global }: SendEventsPluginMeta) {
    global.buffer.flush()
}

//Test that the http status code is 200
function statusOk(res: Response) {
    return String(res.status)[0] === '2'
}
