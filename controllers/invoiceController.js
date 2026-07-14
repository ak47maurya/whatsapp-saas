import Invoice from '../models/Invoice.js';
import ActivityLog from '../models/ActivityLog.js';
import PDFDocument from 'pdfkit';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';

export const adminIndex = async (req, res) => {
  try {
    const invoices = await Invoice.find()
      .populate('user', 'name email')
      .populate('subscription')
      .sort({ createdAt: -1 });
    res.render('admin/invoices/index', {
      title: 'Invoice Management',
      invoices,
      activePage: 'admin-invoices',
    });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const adminMarkPaid = async (req, res) => {
  try {
    const invoice = await Invoice.findByIdAndUpdate(
      req.params.id,
      { status: 'paid', paidAt: new Date(), paymentMethod: 'manual' },
      { new: true }
    );
    if (!invoice) return errorResponse(res, 'Invoice not found', 404);

    await ActivityLog.create({
      user: req.userId,
      action: 'invoice.mark_paid',
      category: 'subscription',
      description: `Marked invoice ${invoice.invoiceNumber} as paid`,
    });

    successResponse(res, { invoice }, 'Invoice marked as paid');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const adminDownloadPdf = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('user', 'name email')
      .populate('subscription');
    if (!invoice) return errorResponse(res, 'Invoice not found', 404);

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`);
    doc.pipe(res);

    doc.fontSize(24).text('INVOICE', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Invoice #: ${invoice.invoiceNumber}`, { align: 'right' });
    doc.text(`Date: ${new Date(invoice.createdAt).toLocaleDateString()}`, { align: 'right' });
    doc.text(`Status: ${invoice.status}`, { align: 'right' });
    doc.moveDown(2);

    doc.fontSize(14).text('Bill To:');
    doc.fontSize(12);
    doc.text(invoice.user?.name || invoice.user?.email || '—');
    doc.text(invoice.user?.email || '');
    doc.moveDown(2);

    const tableTop = doc.y;
    doc.fontSize(12).font('Helvetica-Bold');
    doc.text('Description', 50, tableTop);
    doc.text('Qty', 350, tableTop);
    doc.text('Price', 420, tableTop);
    doc.text('Total', 500, tableTop);

    doc.moveDown(0.5);
    doc.font('Helvetica');
    (invoice.items || [{ description: 'Subscription', quantity: 1, unitPrice: invoice.amount, total: invoice.amount }]).forEach(item => {
      const y = doc.y;
      doc.text(item.description, 50, y);
      doc.text(String(item.quantity), 350, y);
      doc.text(`₹${item.unitPrice}`, 420, y);
      doc.text(`₹${item.total}`, 500, y);
      doc.moveDown(0.5);
    });

    doc.moveDown();
    doc.fontSize(14).font('Helvetica-Bold');
    doc.text(`Total: ₹${invoice.total}`, { align: 'right' });

    doc.end();
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const customerIndex = async (req, res) => {
  try {
    const invoices = await Invoice.find({ user: req.userId })
      .populate('subscription')
      .sort({ createdAt: -1 });
    res.render('invoice/index', {
      title: 'My Invoices',
      invoices,
      activePage: 'invoices',
    });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const customerDownloadPdf = async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ _id: req.params.id, user: req.userId })
      .populate('user', 'name email')
      .populate('subscription');
    if (!invoice) return errorResponse(res, 'Invoice not found', 404);

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`);
    doc.pipe(res);

    doc.fontSize(24).text('INVOICE', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Invoice #: ${invoice.invoiceNumber}`, { align: 'right' });
    doc.text(`Date: ${new Date(invoice.createdAt).toLocaleDateString()}`, { align: 'right' });
    doc.text(`Status: ${invoice.status}`, { align: 'right' });
    doc.moveDown(2);

    doc.fontSize(14).text('Bill To:');
    doc.fontSize(12);
    doc.text(invoice.user?.name || '—');
    doc.text(invoice.user?.email || '');
    doc.moveDown(2);

    doc.fontSize(12).font('Helvetica-Bold');
    doc.text('Description', 50, doc.y);
    doc.text('Qty', 350, doc.y);
    doc.text('Price', 420, doc.y);
    doc.text('Total', 500, doc.y);
    doc.moveDown(0.5);
    doc.font('Helvetica');
    (invoice.items || [{ description: 'Subscription', quantity: 1, unitPrice: invoice.amount, total: invoice.amount }]).forEach(item => {
      const y = doc.y;
      doc.text(item.description, 50, y);
      doc.text(String(item.quantity), 350, y);
      doc.text(`₹${item.unitPrice}`, 420, y);
      doc.text(`₹${item.total}`, 500, y);
      doc.moveDown(0.5);
    });

    doc.moveDown();
    doc.fontSize(14).font('Helvetica-Bold');
    doc.text(`Total: ₹${invoice.total}`, { align: 'right' });

    doc.end();
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};