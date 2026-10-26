using MapsterMapper;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model;
using Vistoria.Api.Repositories;

namespace Vistoria.Api.Services.Impl;

public class InspectionService(
    IInspectionRepository inspections, IRepository<Property> properties, IMapper mapper, TimeProvider time)
    : SyncEntityService<Inspection, InspectionDto>(inspections, mapper), IInspectionService
{
    private readonly IMapper _mapper = mapper;

    public Task<(InspectionDto Inspection, bool Created)> UpsertAsync(
        Guid ownerId, Guid id, string? ifMatch, UpsertInspectionDto request, CancellationToken cancellationToken) =>
        UpsertAsync(ownerId, id, ifMatch, _mapper.Map<Inspection>(request), cancellationToken);

    // Concluída não muda mais (backend.md, "Regra do agregado").
    protected override bool IsLocked(Inspection current) => current.Status == InspectionStatus.Completed;

    // O que as Data Annotations não alcançam. Imóvel de outro dono responde igual ao inexistente, para o id dele não
    // vazar. A vistoria concluída (inclusive a que já nasce concluída, feita toda offline) ganha o CompletedAt aqui;
    // o que o cliente mandou nele nunca chega ao modelo.
    protected override async Task ValidateAsync(Inspection proposed, Guid ownerId, CancellationToken cancellationToken)
    {
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        var completing = proposed.Status == InspectionStatus.Completed;
        if (completing)
        {
            CompletionErrors(proposed, errors);
        }

        var property = await properties.FindByIdAsync(proposed.PropertyId, cancellationToken);
        if (property is null || property.OwnerId != ownerId)
        {
            errors["propertyId"] = ["Imóvel não encontrado."];
        }

        var paths = ChildPaths(proposed, errors);
        if (paths.Count > 0)
        {
            var taken = await inspections.FindChildIdsOfOtherInspectionsAsync(
                proposed.Id,
                [.. paths.Where(p => p.IsRoom).Select(p => p.Id)],
                [.. paths.Where(p => !p.IsRoom).Select(p => p.Id)],
                cancellationToken);
            foreach (var (_, path, _) in paths.Where(p => taken.Contains(p.Id)))
            {
                errors[path] = ["Id já usado em outra vistoria."];
            }
        }

        if (errors.Count > 0)
        {
            throw new ValidationException(errors);
        }

        proposed.CompletedAt = completing ? time.GetUtcNow() : null;
    }

    // Para concluir: ao menos um ambiente, ao menos um item em cada um e todos os itens avaliados. Elemento nulo já é
    // erro do ChildPaths.
    private static void CompletionErrors(Inspection proposed, Dictionary<string, string[]> errors)
    {
        if (proposed.Rooms.Count == 0)
        {
            errors["rooms"] = ["Para concluir, a vistoria precisa de ao menos um ambiente."];
        }

        for (var r = 0; r < proposed.Rooms.Count; r++)
        {
            if (proposed.Rooms[r] is not { } room)
            {
                continue;
            }

            if (room.Items.Count == 0)
            {
                errors[$"rooms[{r}].items"] = ["Para concluir, o ambiente precisa de ao menos um item."];
            }

            for (var i = 0; i < room.Items.Count; i++)
            {
                if (room.Items[i] is { Condition: null })
                {
                    errors[$"rooms[{r}].items[{i}].condition"] = ["Para concluir, avalie a condição do item."];
                }
            }
        }
    }

    // Elemento nulo (o validador do MVC o pula) e id repetido. Os ids são únicos na vistoria toda, não só no ambiente:
    // são a chave dos ambientes e itens no banco. Devolve o caminho de cada id que passou, para a consulta no banco.
    private static List<(Guid Id, string Path, bool IsRoom)> ChildPaths(
        Inspection proposed, Dictionary<string, string[]> errors)
    {
        var paths = new List<(Guid Id, string Path, bool IsRoom)>();
        var roomIds = new HashSet<Guid>();
        var itemIds = new HashSet<Guid>();
        for (var r = 0; r < proposed.Rooms.Count; r++)
        {
            var room = proposed.Rooms[r];
            if (room is null)
            {
                errors[$"rooms[{r}]"] = ["Informe o ambiente."];
                continue;
            }

            if (roomIds.Add(room.Id))
            {
                paths.Add((room.Id, $"rooms[{r}].id", true));
            }
            else
            {
                errors[$"rooms[{r}].id"] = ["Id de ambiente repetido na vistoria."];
            }

            for (var i = 0; i < room.Items.Count; i++)
            {
                var item = room.Items[i];
                if (item is null)
                {
                    errors[$"rooms[{r}].items[{i}]"] = ["Informe o item."];
                }
                else if (itemIds.Add(item.Id))
                {
                    paths.Add((item.Id, $"rooms[{r}].items[{i}].id", false));
                }
                else
                {
                    errors[$"rooms[{r}].items[{i}].id"] = ["Id de item repetido na vistoria."];
                }
            }
        }

        return paths;
    }
}
