using Microsoft.EntityFrameworkCore;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Base;
using Vistoria.Api.Model.Context;

namespace Vistoria.Api.Repositories.Impl;

public class InspectionRepository(AppDbContext db) : GenericRepository<Inspection>(db), IInspectionRepository
{
    private static readonly string[] SoftDelete = [AppDbContext.SoftDeleteFilter];

    // O filtro global de soft delete vale também dentro do Include: ambiente ou item excluído não vem. Uma consulta só,
    // não split: duas leituras poderiam pegar a raiz de uma versão e os filhos de outra, com uma gravação no meio.
    public override Task<Inspection?> FindByIdAsync(Guid id, CancellationToken cancellationToken) =>
        Set.AsNoTracking()
            .Include(i => i.Rooms.OrderBy(r => r.Position))
            .ThenInclude(r => r.Items.OrderBy(it => it.Position))
            .AsSingleQuery()
            .SingleOrDefaultAsync(i => i.Id == id, cancellationToken);

    public override async Task<Inspection> AddAsync(Inspection entity, CancellationToken cancellationToken)
    {
        try
        {
            await base.AddAsync(entity, cancellationToken);
        }
        catch (DuplicateIdException)
        {
            // O genérico solta só a raiz; ambientes e itens ainda estariam Added para um próximo SaveChanges.
            Detach(entity);
            throw;
        }

        Detach(entity);
        return Live(entity);
    }

    // Mesmo contrato do genérico (a versão-base no WHERE, e a raiz sempre regravada), com os filhos casados por id. Os
    // excluídos vêm junto, para um id reenviado reviver o seu em vez de esbarrar na chave primária.
    public override async Task<Inspection?> UpdateAsync(Inspection entity, CancellationToken cancellationToken)
    {
        var current = await Set.IgnoreQueryFilters(SoftDelete)
            .Include(i => i.Rooms)
            .ThenInclude(r => r.Items)
            .AsSingleQuery()
            .SingleOrDefaultAsync(i => i.Id == entity.Id, cancellationToken);
        if (current is null || current.DeletedAt is not null)
        {
            return null;
        }

        // Definidos uma vez (na criação, na conclusão, na saída): o PUT não os regrava.
        var (startedAt, completedAt, referenceId) =
            (current.StartedAt, current.CompletedAt, current.ReferenceInspectionId);
        var entry = Db.Entry(current);
        entry.CurrentValues.SetValues(entity);
        (current.StartedAt, current.CompletedAt, current.ReferenceInspectionId) = (startedAt, completedAt, referenceId);
        entry.Property(e => e.Version).OriginalValue = entity.Version;
        entry.State = EntityState.Modified;

        var rooms = current.Rooms.ToDictionary(r => r.Id);
        var items = current.Rooms.SelectMany(r => r.Items).ToDictionary(it => it.Id);
        foreach (var proposed in entity.Rooms)
        {
            var room = FindOrAdd(rooms, proposed.Id);
            room.InspectionId = current.Id;
            (room.Name, room.Position, room.Notes) = (proposed.Name, proposed.Position, proposed.Notes);
            foreach (var proposedItem in proposed.Items)
            {
                // Pelo RoomId, não pelas listas: tirar o item da lista de um ambiente faria o EF excluí-lo como órfão.
                var item = FindOrAdd(items, proposedItem.Id);
                item.RoomId = room.Id;
                (item.Name, item.Position, item.Condition, item.Notes) =
                    (proposedItem.Name, proposedItem.Position, proposedItem.Condition, proposedItem.Notes);
            }
        }

        // Itens antes dos ambientes, e depois de os itens movidos já estarem no ambiente novo: o cascade do EF é
        // imediato e levaria junto o que ainda parecesse do ambiente removido.
        Db.ChangeTracker.DetectChanges();
        DropOmitted(items.Values, entity.Rooms.SelectMany(r => r.Items));
        DropOmitted(rooms.Values, entity.Rooms);

        await Db.SaveChangesAsync(cancellationToken);
        Detach(current);
        return Live(current);
    }

    public async Task<IReadOnlySet<Guid>> FindChildIdsOfOtherInspectionsAsync(
        Guid inspectionId, IReadOnlyCollection<Guid> roomIds, IReadOnlyCollection<Guid> itemIds,
        CancellationToken cancellationToken)
    {
        // EF.Parameter: a lista vai num parâmetro JSON só. Até 2.400 itens passariam do limite de 2.100 parâmetros.
        var rooms = await Db.Rooms.IgnoreQueryFilters(SoftDelete)
            .Where(r => r.InspectionId != inspectionId && EF.Parameter(roomIds).Contains(r.Id))
            .Select(r => r.Id)
            .ToListAsync(cancellationToken);
        var items = await Db.InspectionItems.IgnoreQueryFilters(SoftDelete)
            .Join(Db.Rooms.IgnoreQueryFilters(SoftDelete), it => it.RoomId, r => r.Id,
                (it, r) => new { it.Id, r.InspectionId })
            .Where(x => x.InspectionId != inspectionId && EF.Parameter(itemIds).Contains(x.Id))
            .Select(x => x.Id)
            .ToListAsync(cancellationToken);
        return rooms.Concat(items).ToHashSet();
    }

    // O filho carregado com esse id, vivo de novo se estava excluído, ou um novo já Added.
    private T FindOrAdd<T>(Dictionary<Guid, T> loaded, Guid id) where T : AggregateChild, new()
    {
        if (loaded.TryGetValue(id, out var child))
        {
            child.DeletedAt = null;
            return child;
        }

        child = new T { Id = id };
        Db.Add(child);
        return child;
    }

    // Vivo que não veio → Remove, que o AppDbContext transforma em DeletedAt. Excluído que não veio sai do tracker,
    // para o cascade de um ambiente removido não regravar o DeletedAt antigo dele.
    private void DropOmitted<T>(IEnumerable<T> loaded, IEnumerable<T> proposed) where T : AggregateChild
    {
        var kept = proposed.Select(c => c.Id).ToHashSet();
        foreach (var child in loaded.Where(c => !kept.Contains(c.Id)))
        {
            if (child.DeletedAt is null)
            {
                Db.Remove(child);
            }
            else
            {
                Db.Entry(child).State = EntityState.Detached;
            }
        }
    }

    // Fora do tracker antes de mexer nas listas para a resposta; senão um SaveChanges posterior as veria como órfãs.
    private void Detach(Inspection inspection)
    {
        List<object> graph = [inspection, .. inspection.Rooms, .. inspection.Rooms.SelectMany(r => r.Items)];
        foreach (var node in graph)
        {
            Db.Entry(node).State = EntityState.Detached;
        }
    }

    // Como o FindByIdAsync devolve: só os vivos, em ordem de position.
    private static Inspection Live(Inspection inspection)
    {
        inspection.Rooms = [.. inspection.Rooms.Where(r => r.DeletedAt is null).OrderBy(r => r.Position)];
        foreach (var room in inspection.Rooms)
        {
            room.Items = [.. room.Items.Where(it => it.DeletedAt is null).OrderBy(it => it.Position)];
        }

        return inspection;
    }
}
