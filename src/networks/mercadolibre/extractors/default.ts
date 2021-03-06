import { ExtractionResult, ExtractorContext, ItemDataExtractor } from "../../../api/extract";
import { ItemData, ItemDisplay } from "../../../api/models/item";
import { assertNotEquals, assertNotNull } from "../../../util/assert";
import CheerioParser from "../../../util/html-parser";
import lodash from 'lodash'
import log4js from "log4js"

const logger = log4js.getLogger("MercadolibreExtractor")

const startSubstring = "window.__PRELOADED_STATE__ = {"


function getImageUrl(imageTemplate: string, image: any) {
    if (typeof (image) == 'object' && image.id) {
        image = image.id
    }
    if (typeof (image) != 'string') return undefined
    return imageTemplate.replace(/\{id\}/, image)
}

function normalizeKey(name: string): string | undefined {
    if (!name) return undefined
    name = name.replace("de ", "")
    name = name.replace("ñ", "ni")
    name = lodash.camelCase(name)
    if (name == 'anio') return 'year'
    if (name == 'marca') return 'brand'
    if (name == 'modelo') return 'model'
    return name
}

function parseValue(key: string, value: any): any {
    if (key == 'year') return parseInt(value)
    if (key == 'puertas') return parseInt(value)
    return value
}

function extractData(json: any, ctx: ExtractorContext): ExtractionResult {
    let { technical_specifications = {}, description, gallery, price, header, track } = json.initialState?.components
    if (!technical_specifications) return { refetchContent: true }

    const eventData = track?.melidata_event?.event_data || {}
    const location: any = {}
    if(eventData){
        const {item_condition, city, state } = eventData
        location.city = city
        location.state = state 
    }else {
        logger.warn(`Can't determine item location`)
    }

    const {currency_id: currency = 'COP', value: priceValue} = price?.price || {}
    const prices = {}
    if(!priceValue){
        logger.warn(`Unable to determine price`)
    }else{
        prices['sale'] = { currency, value: priceValue}
    }
    
    const template = gallery?.picture_config?.template
    const assets = template ? gallery.pictures.map(p => getImageUrl(template, p)) : []
    const image = assets.length > 0 ? assets[0] : undefined
    const display: ItemDisplay = {
        title: header?.title, description: description?.content, image
    }
    const features = {}
    const { specs = [] } = technical_specifications
    const attributes = specs.flatMap(s => s.attributes).map(a => {
        if (a.id && a.text) return a
        if (a.values) return { id: a?.values?.value_text?.text, text: true }
        return undefined
    }).filter(a => a).map(({ id, text }) => {
        const key = normalizeKey(id)
        return { key, value: parseValue(key, text) }
    })
    attributes.forEach(({ key, value }) => features[normalizeKey(key)] = value)
    const extra = {}
    const data: ItemData = { display, features, extra, assets, prices, location }
    return { data }
}


export default class MercadolibreExtractor implements ItemDataExtractor {
    //TODO: Get all images, if they are same size and the size is 21090 it might be a test 
    async extract($: CheerioParser, ctx: ExtractorContext): Promise<ExtractionResult> {

        //Try to detect mobile content, if mobile content is returned, then no 
        //technical_specifications are received
        const mobile = $.findFirst(".andes-carousel-snapped__controls-wrapper")
        if (mobile) return { refetchContent: true }

        const scripts = $.findAll("script")
        const script = scripts.find(s => s.html().indexOf("window.__PRELOADED_STATE__") >= 0)
        if (!script) return { error: "Unable to find data object script" }
        let html = script.html()
        const startIndex = html.indexOf(startSubstring)
        if (startIndex == -1) return { error: "Can't find object start" }
        html = html.substring(startIndex + startSubstring.length - 1)
        const endIndex = html.indexOf('}}};')
        //TODO task should fails if assert fails
        if (endIndex == -1) return { error: "Can't find object end" }
        html = html.substring(0, endIndex + 3).trim()
        return extractData(JSON.parse(html), ctx) //No links available in detail
    }

}