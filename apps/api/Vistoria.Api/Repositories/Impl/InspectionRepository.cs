using Microsoft.EntityFrameworkCore;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Context;

namespace Vistoria.Api.Repositories.Impl;

public class InspectionRepository(AppDbContext db) : GenericRepository<Inspection>(db), IInspectionRepository
{
    // O filtro global de soft delete vale também dentro do Include: ambiente ou item excluído não vem. Uma consulta só,
    // não split: duas leituras poderiam pegar a raiz de uma versão e os filhos de outra, com uma gravação no meio.
    public override Task<Inspection?> FindByIdAsync(Guid id, CancellationToken cancellationToken) =>
        Set.AsNoTracking()
            .Include(i => i.Rooms.OrderBy(r => r.Position))
            .ThenInclude(r => r.Items.OrderBy(it => it.Position))
            .AsSingleQuery()
            .SingleOrDefaultAsync(i => i.Id == id, cancellationToken);
}
