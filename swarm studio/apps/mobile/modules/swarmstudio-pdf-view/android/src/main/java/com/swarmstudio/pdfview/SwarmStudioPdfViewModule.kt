package com.swarmstudio.pdfview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** A PDF drawn with the system PdfRenderer; Android's WebView cannot show one. */
class SwarmStudioPdfViewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SwarmStudioPdfView")

    View(SwarmStudioPdfView::class) {
      Events("onLoadError")
      Prop("uri") { view: SwarmStudioPdfView, uri: String -> view.load(uri) }
      OnViewDestroys { view: SwarmStudioPdfView -> view.release() }
    }
  }
}
